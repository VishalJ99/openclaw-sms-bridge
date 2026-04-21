#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const DEFAULT_CONFIG = path.join(os.homedir(), ".openclaw", "openclaw.json");
const STATE_PATH = path.join(os.homedir(), ".openclaw", "sms-bridge-call-alert-state.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readPluginConfig() {
  const configPath = process.env.OPENCLAW_CONFIG ?? DEFAULT_CONFIG;
  const config = readJson(configPath);
  const pluginConfig = config.plugins?.entries?.["sms-inbox-bridge"]?.config;
  if (!pluginConfig) {
    throw new Error(`sms-inbox-bridge config not found in ${configPath}`);
  }
  const phoneNumber = String(pluginConfig.binding?.phoneNumber ?? "").trim();
  if (!phoneNumber) {
    throw new Error("plugins.entries.sms-inbox-bridge.config.binding.phoneNumber is required");
  }
  const call = pluginConfig.alert?.call ?? {};
  const endpointUrl = new URL(
    String(call.endpointUrl ?? "http://127.0.0.1:18790/call-alert"),
  );
  return {
    phoneNumber,
    token: typeof call.bearerToken === "string" ? call.bearerToken : undefined,
    endpointUrl,
    adbPath: String(call.adbPath ?? process.env.ADB ?? "adb"),
    androidSerial: String(call.androidSerial ?? process.env.ANDROID_SERIAL ?? "").trim(),
    ringSeconds: Number.isFinite(call.ringSeconds) ? Number(call.ringSeconds) : 8,
    cooldownSeconds: Number.isFinite(call.cooldownSeconds) ? Number(call.cooldownSeconds) : 300,
    maxPerDay: Number.isFinite(call.maxPerDay) ? Number(call.maxPerDay) : 3,
    dryRun: process.env.SMS_BRIDGE_CALL_ALERT_DRY_RUN === "1",
  };
}

function readState() {
  try {
    return readJson(STATE_PATH);
  } catch {
    return { attempts: [], lastAttemptAt: 0 };
  }
}

function pruneAttempts(attempts, now) {
  const windowStart = now - 24 * 60 * 60 * 1000;
  return attempts.filter((timestamp) => typeof timestamp === "number" && timestamp >= windowStart);
}

function execAdb(config, args) {
  const fullArgs = config.androidSerial
    ? ["-s", config.androidSerial, ...args]
    : args;
  return new Promise((resolve, reject) => {
    const child = spawn(config.adbPath, fullArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`adb exited ${code}: ${stderr.trim()}`));
    });
  });
}

async function triggerCall(config) {
  if (config.dryRun) {
    return { dryRun: true };
  }
  await execAdb(config, [
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.CALL",
    "-d",
    `tel:${config.phoneNumber}`,
  ]);
  setTimeout(() => {
    void execAdb(config, ["shell", "input", "keyevent", "KEYCODE_ENDCALL"]).catch((error) => {
      console.error(`failed to hang up call alert: ${error.message}`);
    });
  }, Math.max(1, config.ringSeconds) * 1000);
  return { dryRun: false };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4096) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function isAuthorized(req, config) {
  if (!config.token) {
    return true;
  }
  return req.headers.authorization === `Bearer ${config.token}`;
}

const config = readPluginConfig();
const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== config.endpointUrl.pathname) {
    sendJson(res, 404, { status: "not_found" });
    return;
  }
  if (!isAuthorized(req, config)) {
    sendJson(res, 401, { status: "unauthorized" });
    return;
  }

  try {
    const body = await readRequestBody(req);
    const payload = body ? JSON.parse(body) : {};
    const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
    if (!reason) {
      sendJson(res, 400, { status: "failed", error: "reason required" });
      return;
    }

    const now = Date.now();
    const state = readState();
    const attempts = pruneAttempts(Array.isArray(state.attempts) ? state.attempts : [], now);
    const lastAttemptAt = typeof state.lastAttemptAt === "number" ? state.lastAttemptAt : 0;
    const elapsedSeconds = Math.floor((now - lastAttemptAt) / 1000);

    if (config.maxPerDay === 0 || attempts.length >= config.maxPerDay) {
      sendJson(res, 429, { status: "blocked", blockedBy: "daily-limit" });
      return;
    }
    if (lastAttemptAt > 0 && elapsedSeconds < config.cooldownSeconds) {
      sendJson(res, 429, {
        status: "blocked",
        blockedBy: "cooldown",
        retryAfterSeconds: config.cooldownSeconds - elapsedSeconds,
      });
      return;
    }

    const result = await triggerCall(config);
    if (!result.dryRun) {
      attempts.push(now);
      writeJson(STATE_PATH, { attempts, lastAttemptAt: now });
    }
    sendJson(res, 202, {
      status: result.dryRun ? "dry-run" : "requested",
      ringSeconds: config.ringSeconds,
    });
  } catch (error) {
    sendJson(res, 500, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(Number(config.endpointUrl.port || 18790), config.endpointUrl.hostname, () => {
  console.log(
    `sms bridge call-alert helper listening on ${config.endpointUrl.origin}${config.endpointUrl.pathname}`,
  );
  if (config.dryRun) {
    console.log("dry-run enabled: no call will be placed");
  }
});

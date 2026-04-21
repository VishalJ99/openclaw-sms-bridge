#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_PLUGIN_ID = "sms-inbox-bridge";
const DEFAULT_ANDROID_DEVICE_PORT = 8080;
const DEFAULT_ANDROID_HOST_PORT = 18080;
const DEFAULT_GATEWAY_PORT = 18789;

function usage() {
  return `Usage: pnpm local:usb:start

Environment:
  OPENCLAW_CONFIG                    Path to openclaw.json (default: ~/.openclaw/openclaw.json)
  SMS_BRIDGE_PLUGIN_ID               Plugin id (default: sms-inbox-bridge)
  SMS_BRIDGE_ANDROID_HOST_PORT       Host port for adb forward (default: config/apiBaseUrl or 18080)
  SMS_BRIDGE_ANDROID_DEVICE_PORT     Phone Local Server port (default: 8080)
  OPENCLAW_GATEWAY_PORT              Host gateway port for adb reverse (default: config/gateway.port or 18789)
  ANDROID_SERIAL                     adb device serial when multiple devices are attached
  SMS_BRIDGE_REGISTER_WEBHOOK=0      Skip webhook registration/upsert check
`;
}

function expandHome(filePath) {
  if (!filePath.startsWith("~/")) {
    return filePath;
  }
  return path.join(os.homedir(), filePath.slice(2));
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exitCode = 1;
}

async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      ...options,
    });
    return {
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  } catch (error) {
    const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
    const stdout = typeof error.stdout === "string" ? error.stdout.trim() : "";
    throw new Error(
      [error.message, stdout ? `stdout: ${stdout}` : "", stderr ? `stderr: ${stderr}` : ""]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

async function adb(args) {
  const serial = process.env.ANDROID_SERIAL?.trim();
  return await run("adb", serial ? ["-s", serial, ...args] : args);
}

function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw);
}

function readPluginConfig(config, pluginId) {
  const pluginConfig = config?.plugins?.entries?.[pluginId]?.config;
  if (!pluginConfig || typeof pluginConfig !== "object") {
    throw new Error(`missing plugins.entries["${pluginId}"].config in OpenClaw config`);
  }
  return pluginConfig;
}

function readPortFromUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    const port = Number(parsed.port);
    return Number.isInteger(port) && port > 0 ? port : undefined;
  } catch {
    return undefined;
  }
}

function readPort(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  return {
    ok: response.ok,
    status: response.status,
    text: await response.text(),
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(`${url} returned non-JSON response (${response.status}): ${text.slice(0, 200)}`);
  }
  return {
    ok: response.ok,
    status: response.status,
    json,
  };
}

async function assertAdbDevice() {
  await run("adb", ["start-server"]);
  const { stdout } = await run("adb", ["devices", "-l"]);
  const devices = stdout
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /\bdevice\b/.test(line));
  if (devices.length === 0) {
    throw new Error(
      "no adb device is attached. Turn on the phone, unlock it, connect USB, enable USB debugging, and accept the trust prompt.",
    );
  }
  if (devices.length > 1 && !process.env.ANDROID_SERIAL?.trim()) {
    throw new Error(
      `multiple adb devices are attached; set ANDROID_SERIAL. Devices:\n${devices.join("\n")}`,
    );
  }
  console.log(`adb device: ${devices[0]}`);
}

async function ensureWebhook(params) {
  if (process.env.SMS_BRIDGE_REGISTER_WEBHOOK === "0") {
    console.log("webhook registration: skipped by SMS_BRIDGE_REGISTER_WEBHOOK=0");
    return;
  }

  const authHeader = basicAuth(params.username, params.password);
  const webhooksUrl = `${params.apiBaseUrl}/webhooks`;
  const listed = await fetchJson(webhooksUrl, {
    headers: {
      authorization: authHeader,
      accept: "application/json",
    },
  });
  if (!listed.ok || !Array.isArray(listed.json)) {
    throw new Error(`failed to list Android Gateway webhooks: HTTP ${listed.status}`);
  }

  const existing = listed.json.find((entry) => entry?.id === params.webhookId);
  if (
    existing?.event === "sms:received" &&
    existing?.url === params.webhookUrl
  ) {
    console.log(`webhook: already registered (${params.webhookId})`);
    return;
  }
  if (existing) {
    console.warn(
      `warning: webhook id ${params.webhookId} already exists with url=${existing.url}; leaving it unchanged`,
    );
    return;
  }

  const created = await fetchJson(webhooksUrl, {
    method: "POST",
    headers: {
      authorization: authHeader,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      id: params.webhookId,
      url: params.webhookUrl,
      event: "sms:received",
      ...(params.deviceId ? { deviceId: params.deviceId } : {}),
    }),
  });
  if (!created.ok) {
    throw new Error(`failed to register Android Gateway webhook: HTTP ${created.status}`);
  }
  console.log(`webhook: registered ${params.webhookId} -> ${params.webhookUrl}`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage());
    return;
  }

  const configPath = expandHome(
    process.env.OPENCLAW_CONFIG?.trim() || "~/.openclaw/openclaw.json",
  );
  const pluginId = process.env.SMS_BRIDGE_PLUGIN_ID?.trim() || DEFAULT_PLUGIN_ID;
  const config = loadConfig(configPath);
  const pluginConfig = readPluginConfig(config, pluginId);
  const transport = pluginConfig.transport ?? {};
  if (transport.serverMode !== "local") {
    throw new Error(
      `plugins.entries["${pluginId}"].config.transport.serverMode must be "local" for USB setup`,
    );
  }
  if (!transport.username || !transport.password) {
    throw new Error(`plugins.entries["${pluginId}"].config.transport username/password are required`);
  }

  const gatewayPort = readPort(
    process.env.OPENCLAW_GATEWAY_PORT ?? config?.gateway?.port,
    DEFAULT_GATEWAY_PORT,
  );
  const androidHostPort = readPort(
    process.env.SMS_BRIDGE_ANDROID_HOST_PORT ??
      readPortFromUrl(transport.apiBaseUrl),
    DEFAULT_ANDROID_HOST_PORT,
  );
  const androidDevicePort = readPort(
    process.env.SMS_BRIDGE_ANDROID_DEVICE_PORT,
    DEFAULT_ANDROID_DEVICE_PORT,
  );
  const apiBaseUrl = `http://127.0.0.1:${androidHostPort}`;
  const webhookPath = transport.webhookPath || "/plugins/sms-inbox-bridge/webhook";
  const webhookUrl = `http://127.0.0.1:${gatewayPort}${webhookPath}`;

  console.log(`config: ${configPath}`);
  console.log(`plugin: ${pluginId}`);
  console.log(`android local API: ${apiBaseUrl} -> device tcp:${androidDevicePort}`);
  console.log(`openclaw webhook via adb reverse: ${webhookUrl}`);

  await assertAdbDevice();
  await adb(["forward", `tcp:${androidHostPort}`, `tcp:${androidDevicePort}`]);
  console.log(`adb forward: tcp:${androidHostPort} -> tcp:${androidDevicePort}`);
  await adb(["reverse", `tcp:${gatewayPort}`, `tcp:${gatewayPort}`]);
  console.log(`adb reverse: tcp:${gatewayPort} -> tcp:${gatewayPort}`);

  const health = await fetchJson(`${apiBaseUrl}/health`);
  if (!health.ok || health.json?.status !== "pass") {
    throw new Error(`Android Gateway health failed: HTTP ${health.status}`);
  }
  console.log(`android health: ${health.json.status}`);

  const hostRoute = await fetchText(webhookUrl);
  if (hostRoute.status !== 405) {
    throw new Error(`OpenClaw webhook route check expected HTTP 405, got ${hostRoute.status}`);
  }
  console.log("openclaw route: reachable from host");

  let phoneRoute;
  try {
    phoneRoute = await adb([
      "shell",
      "curl",
      "-sS",
      "-m",
      "5",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      webhookUrl,
    ]);
  } catch (error) {
    console.warn(
      `warning: phone-to-host route check skipped because adb shell curl failed: ${
        error instanceof Error ? error.message.split("\n")[0] : String(error)
      }`,
    );
  }
  if (phoneRoute && phoneRoute.stdout.trim() !== "405") {
    throw new Error(
      `phone-to-host reverse route expected HTTP 405, got ${phoneRoute.stdout.trim() || "<empty>"}`,
    );
  }
  if (phoneRoute) {
    console.log("openclaw route: reachable from phone over adb reverse");
  }

  await ensureWebhook({
    apiBaseUrl,
    deviceId: transport.deviceId,
    password: transport.password,
    username: transport.username,
    webhookId: pluginId,
    webhookUrl,
  });

  console.log("ready: Android Local Server USB bridge is initialized");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});

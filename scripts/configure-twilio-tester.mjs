#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_CONFIG_PATH = "~/.openclaw/openclaw.json";
const DEFAULT_PLUGIN_ID = "sms-inbox-bridge";
const DEFAULT_ROUTE_PATH = "/plugins/sms-inbox-bridge/tester/twilio";
const DEFAULT_SESSION_SUFFIX = "sms:twilio-tester";

function expandHome(filePath) {
  if (!filePath.startsWith("~/")) {
    return filePath;
  }
  return path.join(os.homedir(), filePath.slice(2));
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const entries = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    entries[trimmed.slice(0, separator).trim()] = stripQuotes(trimmed.slice(separator + 1));
  }
  return entries;
}

function readVar(env, name, fallbackNames = []) {
  for (const key of [name, ...fallbackNames]) {
    const value = process.env[key] ?? env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function requireVar(env, name, fallbackNames = []) {
  const value = readVar(env, name, fallbackNames);
  if (!value) {
    throw new Error(`missing ${name} in .env`);
  }
  return value;
}

function deriveTesterSessionKey(bindingSessionKey) {
  const match = /^agent:([^:]+):/i.exec(String(bindingSessionKey ?? "").trim());
  return `agent:${match?.[1] ?? "main"}:${DEFAULT_SESSION_SUFFIX}`;
}

function main() {
  const envPath = path.resolve(process.cwd(), ".env");
  const env = loadEnv(envPath);
  const configPath = expandHome(
    readVar(env, "OPENCLAW_CONFIG") ?? DEFAULT_CONFIG_PATH,
  );
  const pluginId = readVar(env, "SMS_BRIDGE_PLUGIN_ID") ?? DEFAULT_PLUGIN_ID;
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const pluginEntry = config?.plugins?.entries?.[pluginId];
  if (!pluginEntry || typeof pluginEntry !== "object") {
    throw new Error(`missing plugins.entries["${pluginId}"] in ${configPath}`);
  }
  const pluginConfig = pluginEntry.config ?? {};
  const binding = pluginConfig.binding ?? {};
  if (!binding.phoneNumber) {
    throw new Error(`plugins.entries["${pluginId}"].config.binding.phoneNumber is required`);
  }

  const twilioPhoneNumber = requireVar(env, "TWILIO_PHONE_NUMBER", [
    "SMS_BRIDGE_TWILIO_PHONE_NUMBER",
  ]);
  const sharedSecret =
    readVar(env, "SMS_BRIDGE_TESTER_SECRET") ?? crypto.randomBytes(24).toString("hex");
  pluginEntry.config = {
    ...pluginConfig,
    tester: {
      enabled: true,
      routePath: readVar(env, "SMS_BRIDGE_TESTER_ROUTE_PATH") ?? DEFAULT_ROUTE_PATH,
      sessionKey:
        readVar(env, "SMS_BRIDGE_TESTER_SESSION_KEY") ??
        deriveTesterSessionKey(binding.sessionKey),
      phoneNumber: twilioPhoneNumber,
      sharedSecret,
      twilio: {
        accountSid: requireVar(env, "TWILIO_ACCOUNT_SID"),
        authToken: requireVar(env, "TWILIO_AUTH_TOKEN"),
        fromNumber: twilioPhoneNumber,
      },
    },
  };

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`configured ${pluginId} Twilio tester in ${configPath}`);
  console.log(`route: ${pluginEntry.config.tester.routePath}`);
  console.log(`session: ${pluginEntry.config.tester.sessionKey}`);
  if (!readVar(env, "SMS_BRIDGE_TESTER_SECRET")) {
    console.log("warning: generated a tester secret in OpenClaw config; add it to .env for repeatable scripts");
  }
}

main();

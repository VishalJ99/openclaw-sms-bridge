#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_CONFIG_PATH = "~/.openclaw/openclaw.json";
const DEFAULT_PLUGIN_ID = "sms-inbox-bridge";
const DEFAULT_GATEWAY_PORT = 18789;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

function usage() {
  return `Usage: pnpm tester:twilio [--wait] [--physical] [--trigger-export] [message...]

Default mode posts a synthetic inbound event through the plugin tester route.
With --physical, Twilio sends a real SMS to the Android gateway SIM instead.
With --trigger-export, the script asks Android Gateway to export the new inbox
window after sending the physical SMS. With --wait, it polls Twilio for the
Android gateway reply to the configured Twilio number.
`;
}

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

function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function requireVar(env, name, fallbackNames = []) {
  const value = readVar(env, name, fallbackNames);
  if (!value) {
    throw new Error(`missing ${name} in .env`);
  }
  return value;
}

function normalizePhone(value) {
  return String(value ?? "").replace(/[^\d+]/g, "");
}

function isNewerThan(message, sinceMs) {
  const candidates = [message.date_created, message.date_sent, message.date_updated];
  return candidates.some((value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed >= sinceMs;
  });
}

async function sendViaTesterRoute(params) {
  const response = await fetch(params.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-sms-bridge-tester-secret": params.sharedSecret,
    },
    body: JSON.stringify({
      text: params.message,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`tester route failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function sendViaTwilio(params) {
  const url = new URL(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
      params.accountSid,
    )}/Messages.json`,
  );
  const body = new URLSearchParams({
    From: params.from,
    To: params.to,
    Body: params.message,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: basicAuth(params.accountSid, params.authToken),
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Twilio send failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function requestInboxExport(params) {
  const transport = params.pluginConfig.transport;
  if (transport.serverMode !== "local") {
    throw new Error("Android inbox export requires transport.serverMode=local");
  }
  if (!transport.deviceId) {
    throw new Error("Android inbox export requires transport.deviceId");
  }
  const url = new URL(`${String(transport.apiBaseUrl).replace(/\/$/, "")}/messages/inbox/export`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: basicAuth(transport.username, transport.password),
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      deviceId: transport.deviceId,
      since: new Date(params.sinceMs).toISOString(),
      until: new Date(params.untilMs).toISOString(),
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Android inbox export failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  }
}

async function listTwilioMessages(params) {
  const url = new URL(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
      params.accountSid,
    )}/Messages.json`,
  );
  url.searchParams.set("To", params.to);
  url.searchParams.set("PageSize", "20");
  const response = await fetch(url, {
    headers: {
      authorization: basicAuth(params.accountSid, params.authToken),
      accept: "application/json",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Twilio poll failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  }
  const parsed = text ? JSON.parse(text) : {};
  return Array.isArray(parsed.messages) ? parsed.messages : [];
}

async function waitForReply(params) {
  const deadline = Date.now() + params.timeoutMs;
  while (Date.now() < deadline) {
    const messages = await listTwilioMessages({
      accountSid: params.accountSid,
      authToken: params.authToken,
      to: params.twilioPhoneNumber,
    });
    const reply = messages.find((message) => {
      return (
        normalizePhone(message.to) === normalizePhone(params.twilioPhoneNumber) &&
        normalizePhone(message.from) !== normalizePhone(params.twilioPhoneNumber) &&
        message.direction === "inbound" &&
        isNewerThan(message, params.sinceMs)
      );
    });
    if (reply) {
      return reply;
    }
    await delay(params.pollIntervalMs);
  }
  return undefined;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return;
  }
  const wait = args.includes("--wait");
  const physical = args.includes("--physical");
  const triggerExport = args.includes("--trigger-export");
  if (triggerExport && !physical) {
    throw new Error("--trigger-export requires --physical");
  }
  const messageArgs = args.filter(
    (arg) => arg !== "--wait" && arg !== "--physical" && arg !== "--trigger-export",
  );
  const message =
    messageArgs.join(" ").trim() ||
    `Reply with exactly ${physical ? "PHYSICAL_OK" : "TESTER_OK"}. Twilio bridge test ${new Date().toISOString()}`;

  const env = loadEnv(path.resolve(process.cwd(), ".env"));
  const configPath = expandHome(readVar(env, "OPENCLAW_CONFIG") ?? DEFAULT_CONFIG_PATH);
  const pluginId = readVar(env, "SMS_BRIDGE_PLUGIN_ID") ?? DEFAULT_PLUGIN_ID;
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const pluginConfig = config?.plugins?.entries?.[pluginId]?.config;
  if (!pluginConfig?.tester?.enabled) {
    throw new Error(`plugins.entries["${pluginId}"].config.tester.enabled is not true`);
  }
  const gatewayUrl =
    readVar(env, "OPENCLAW_GATEWAY_URL") ??
    `http://127.0.0.1:${Number(config?.gateway?.port) || DEFAULT_GATEWAY_PORT}`;
  const routeUrl = new URL(pluginConfig.tester.routePath, gatewayUrl);
  const sinceMs = Date.now() - 5_000;
  if (physical) {
    const androidGatewayPhoneNumber = requireVar(env, "SMS_BRIDGE_GATEWAY_PHONE_NUMBER", [
      "ANDROID_GATEWAY_PHONE_NUMBER",
      "SMS_GATEWAY_PHONE_NUMBER",
    ]);
    const sent = await sendViaTwilio({
      accountSid: pluginConfig.tester.twilio.accountSid,
      authToken: pluginConfig.tester.twilio.authToken,
      from: pluginConfig.tester.twilio.fromNumber,
      message,
      to: androidGatewayPhoneNumber,
    });
    console.log(
      JSON.stringify(
        {
          status: "physical_sms_sent",
          sid: sent.sid,
          testerSessionKey: pluginConfig.tester.sessionKey,
        },
        null,
        2,
      ),
    );
    if (triggerExport) {
      const exportDelayMs =
        Number(readVar(env, "SMS_BRIDGE_PHYSICAL_EXPORT_DELAY_MS")) || 15_000;
      await delay(exportDelayMs);
      await requestInboxExport({
        pluginConfig,
        sinceMs,
        untilMs: Date.now(),
      });
      console.log(
        JSON.stringify(
          {
            status: "inbox_export_requested",
            since: new Date(sinceMs).toISOString(),
          },
          null,
          2,
        ),
      );
    }
  } else {
    const sent = await sendViaTesterRoute({
      message,
      sharedSecret: pluginConfig.tester.sharedSecret,
      url: routeUrl,
    });
    console.log(
      JSON.stringify(
        {
          status: "accepted_inbound",
          route: String(routeUrl),
          externalId: sent.externalId,
          testerSessionKey: sent.sessionKey ?? pluginConfig.tester.sessionKey,
        },
        null,
        2,
      ),
    );
  }

  if (!wait) {
    return;
  }
  const reply = await waitForReply({
    accountSid: pluginConfig.tester.twilio.accountSid,
    androidPhoneNumber: pluginConfig.binding.phoneNumber,
    authToken: pluginConfig.tester.twilio.authToken,
    pollIntervalMs:
      Number(readVar(env, "SMS_BRIDGE_TWILIO_TEST_POLL_INTERVAL_MS")) ||
      DEFAULT_POLL_INTERVAL_MS,
    sinceMs,
    timeoutMs:
      Number(readVar(env, "SMS_BRIDGE_TWILIO_TEST_TIMEOUT_MS")) || DEFAULT_TIMEOUT_MS,
    twilioPhoneNumber: pluginConfig.tester.phoneNumber,
  });
  if (!reply) {
    console.error("no Twilio reply observed before timeout");
    process.exitCode = 2;
    return;
  }
  console.log(
    JSON.stringify(
      {
        status: "reply_received",
        sid: reply.sid,
        body: reply.body,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

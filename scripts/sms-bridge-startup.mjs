#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_RETRIES = 30;
const DEFAULT_RETRY_DELAY_MS = 10_000;
const DEFAULT_PATH = [
  "/Users/dross/.local/bin",
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
].join(":");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const localUsbStart = path.join(scriptDir, "local-usb-start.mjs");

function readPositiveInteger(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function timestamp() {
  return new Date().toISOString();
}

function runLocalUsbStart(attempt, retries) {
  return new Promise((resolve) => {
    console.log(`[${timestamp()}] sms bridge startup attempt ${attempt}/${retries}`);
    const child = spawn(process.execPath, [localUsbStart], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: process.env.PATH || DEFAULT_PATH,
      },
      stdio: "inherit",
    });

    child.on("error", (error) => {
      console.error(`[${timestamp()}] failed to launch local USB setup: ${error.message}`);
      resolve(1);
    });
    child.on("close", (code, signal) => {
      if (signal) {
        console.error(`[${timestamp()}] local USB setup exited on signal ${signal}`);
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function main() {
  const retries = readPositiveInteger("SMS_BRIDGE_STARTUP_RETRIES", DEFAULT_RETRIES);
  const retryDelayMs = readPositiveInteger(
    "SMS_BRIDGE_STARTUP_RETRY_DELAY_MS",
    DEFAULT_RETRY_DELAY_MS,
  );

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const code = await runLocalUsbStart(attempt, retries);
    if (code === 0) {
      console.log(`[${timestamp()}] sms bridge USB startup ready`);
      return;
    }
    if (attempt < retries) {
      console.warn(
        `[${timestamp()}] sms bridge USB startup failed with exit ${code}; retrying in ${retryDelayMs}ms`,
      );
      await delay(retryDelayMs);
    }
  }

  console.error(`[${timestamp()}] sms bridge USB startup failed after ${retries} attempts`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[${timestamp()}] sms bridge USB startup crashed: ${error.message}`);
  process.exitCode = 1;
});

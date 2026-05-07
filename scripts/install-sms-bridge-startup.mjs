#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const LABEL = "ai.openclaw.sms-bridge-usb";
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
const startupScript = path.join(scriptDir, "sms-bridge-startup.mjs");
const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
const logsDir = path.join(os.homedir(), ".openclaw", "logs");
const plistPath = path.join(launchAgentsDir, `${LABEL}.plist`);
const domain = `gui/${process.getuid()}`;
const serviceTarget = `${domain}/${LABEL}`;

function usage() {
  return `Usage:
  node scripts/install-sms-bridge-startup.mjs [--no-load]
  node scripts/install-sms-bridge-startup.mjs --uninstall
  node scripts/install-sms-bridge-startup.mjs --print-plist

Installs a user LaunchAgent that runs scripts/sms-bridge-startup.mjs at login
and every 5 minutes. The startup runner recreates the Android Local Server ADB
forward/reverse path and registers the webhook when needed.
`;
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildPlist() {
  const pathValue = process.env.SMS_BRIDGE_STARTUP_PATH || DEFAULT_PATH;
  const configPath = process.env.OPENCLAW_CONFIG || path.join(os.homedir(), ".openclaw", "openclaw.json");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(LABEL)}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(startupScript)}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${xml(repoRoot)}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>StartInterval</key>
  <integer>300</integer>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(pathValue)}</string>
    <key>OPENCLAW_CONFIG</key>
    <string>${xml(configPath)}</string>
  </dict>

  <key>StandardOutPath</key>
  <string>${xml(path.join(logsDir, "sms-bridge-startup.log"))}</string>

  <key>StandardErrorPath</key>
  <string>${xml(path.join(logsDir, "sms-bridge-startup.err.log"))}</string>
</dict>
</plist>
`;
}

async function launchctl(args, options = {}) {
  try {
    const result = await execFileAsync("launchctl", args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return result;
  } catch (error) {
    if (options.allowFailure) {
      return {
        stdout: typeof error.stdout === "string" ? error.stdout : "",
        stderr: typeof error.stderr === "string" ? error.stderr : "",
      };
    }
    throw error;
  }
}

async function install(options) {
  fs.mkdirSync(launchAgentsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(plistPath, buildPlist(), { mode: 0o644 });
  console.log(`installed ${plistPath}`);

  if (options.noLoad) {
    console.log("launchd load skipped by --no-load");
    return;
  }

  await launchctl(["bootout", serviceTarget], { allowFailure: true });
  await launchctl(["bootstrap", domain, plistPath]);
  await launchctl(["enable", serviceTarget]);
  await launchctl(["kickstart", "-k", serviceTarget]);
  console.log(`loaded ${serviceTarget}`);
}

async function uninstall() {
  await launchctl(["bootout", serviceTarget], { allowFailure: true });
  if (fs.existsSync(plistPath)) {
    fs.unlinkSync(plistPath);
    console.log(`removed ${plistPath}`);
  } else {
    console.log(`${plistPath} was not installed`);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    console.log(usage());
    return;
  }
  if (args.has("--print-plist")) {
    console.log(buildPlist());
    return;
  }
  if (args.has("--uninstall")) {
    await uninstall();
    return;
  }
  await install({ noLoad: args.has("--no-load") });
}

main().catch((error) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

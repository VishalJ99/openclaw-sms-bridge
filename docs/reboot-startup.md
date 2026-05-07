# Reboot Startup

The OpenClaw gateway already runs as a user LaunchAgent. The SMS bridge also needs the Android Local Server USB path recreated after a Mac reboot because ADB forward/reverse state is not persistent.

This repo provides two startup helpers:

- `scripts/sms-bridge-startup.mjs` runs the existing `scripts/local-usb-start.mjs` command with boot-time retries.
- `scripts/install-sms-bridge-startup.mjs` installs a user LaunchAgent named `ai.openclaw.sms-bridge-usb`.

## Install

From this repo:

```bash
node scripts/install-sms-bridge-startup.mjs
```

The installer writes:

```text
~/Library/LaunchAgents/ai.openclaw.sms-bridge-usb.plist
```

The LaunchAgent runs at login and every 5 minutes. Each run is idempotent: it recreates the ADB forward to the Android SMS Gateway Local Server, recreates the ADB reverse to the OpenClaw gateway, verifies both endpoints, and confirms the webhook registration.

Logs are written to:

```text
~/.openclaw/logs/sms-bridge-startup.log
~/.openclaw/logs/sms-bridge-startup.err.log
```

## Verify

Check that launchd loaded the agent:

```bash
launchctl print gui/$(id -u)/ai.openclaw.sms-bridge-usb
```

Check the last startup attempt:

```bash
tail -n 80 ~/.openclaw/logs/sms-bridge-startup.log
tail -n 80 ~/.openclaw/logs/sms-bridge-startup.err.log
```

Then run the physical smoke test:

```bash
pnpm tester:twilio --physical --wait
```

A healthy bridge returns:

```json
{
  "status": "reply_received",
  "body": "PHYSICAL_OK"
}
```

## Uninstall

```bash
node scripts/install-sms-bridge-startup.mjs --uninstall
```

## Notes

- Keep the Android handset connected over USB with USB debugging authorized.
- Keep SMS Gateway for Android Local Server enabled on the handset.
- The first post-reboot ADB run may trigger a macOS security dialog for `adb`; click `Open` once and rerun the installer or wait for the next LaunchAgent interval.
- The LaunchAgent does not store SMS Gateway credentials. It reads the existing OpenClaw config path from `OPENCLAW_CONFIG` or `~/.openclaw/openclaw.json`.

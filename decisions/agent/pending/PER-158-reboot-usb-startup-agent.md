# Decision: Recreate the SMS bridge USB path from launchd after reboot
Date: 2026-05-07
Related tickets: PER-158
Related commits: pending

## Context
The OpenClaw gateway can restart from its own LaunchAgent after a Mac reboot, but the Android Local Server path depends on ADB forward/reverse state. That state is ephemeral and is lost across reboots, ADB server restarts, and some phone reconnects.

## Decision
Add a repo-owned startup runner and installer:

- `scripts/sms-bridge-startup.mjs` retries the existing local USB bootstrap command during startup.
- `scripts/install-sms-bridge-startup.mjs` installs a user LaunchAgent named `ai.openclaw.sms-bridge-usb`.
- `docs/reboot-startup.md` documents installation, verification, and uninstall.

The LaunchAgent runs at login and every 5 minutes. Each invocation is idempotent and reuses `scripts/local-usb-start.mjs` rather than duplicating the ADB/webhook logic.

## Rationale
The bridge should recover after a Mac reboot without requiring the operator to remember the USB setup command. Reusing the existing bootstrap command keeps one source of truth for ADB forwarding, Android Gateway health, route reachability, and webhook registration.

## Alternatives considered
- Rely on the operator to run `pnpm local:usb:start` manually after every reboot.
- Move USB bootstrap into the OpenClaw plugin itself.
- Add a long-running daemon instead of a short launchd-triggered idempotent command.

## Scope
This applies to the current Local Server USB setup for the attached Android handset. It does not replace the OpenClaw gateway LaunchAgent and does not introduce a new SMS transport.

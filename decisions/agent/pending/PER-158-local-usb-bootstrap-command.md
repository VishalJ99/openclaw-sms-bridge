# Decision: Package USB Local Server initialization as a repo command
Ticket: PER-158
Timestamp: 2026-04-21T15:00:00Z

## What I decided
I added a `pnpm local:usb:start` command and package binary that recreate the Android Local Server USB tunnels, verify both runtime endpoints, and register the inbound webhook when missing.

## Why
The verified Local Server setup depends on ephemeral `adb forward` and `adb reverse` state, which disappears after phone disconnects, power-off, or `adb` restart. A single repo-owned command is more reproducible than asking operators to remember two tunnel commands plus several checks.

## Impact
Cold-start and reconnect recovery now have a documented command path. The helper assumes the current Local Server architecture: Android API on device port `8080`, host API on `127.0.0.1:18080`, and OpenClaw gateway on `127.0.0.1:18789` unless environment variables override those values.

## How to undo
Remove `scripts/local-usb-start.mjs`, remove `local:usb:start` and the package `bin` entry from `package.json`, and revert the README cold-start section. Operators would return to manually running `adb forward`, `adb reverse`, and webhook registration commands.

# Decision: Package USB Local Server initialization as a repo command
Date: 2026-04-21
Related tickets: PER-158
Related commits: 6714de4, 876cffd

## Context
The verified Android Local Server setup depends on ADB USB tunnel state between the Mac and the Android handset. That state is ephemeral and can disappear after phone disconnects, reboot, or ADB restart.

This promotes the agent pending decision `PER-158-local-usb-bootstrap-command.md`.

## Decision
The repository provides `pnpm local:usb:start` as the supported command to recreate Android Local Server USB tunnels, verify runtime endpoints, and register the inbound webhook when missing.

## Rationale
A single repo-owned command is more reproducible than asking operators to remember the needed `adb forward`, `adb reverse`, health checks, and webhook registration sequence. The helper is intentionally not included in the OpenClaw plugin package because its environment access and local network checks trigger plugin-install security scanning.

## Alternatives considered
- Document manual ADB commands only.
- Embed USB setup logic in the installable OpenClaw plugin package.
- Require a separate operator script outside the repository.

## Scope
Applies to Local Server operation with the attached Android USB handset. It assumes Android API port `8080`, host API `127.0.0.1:18080`, and OpenClaw gateway `127.0.0.1:18789` unless overridden by environment variables.

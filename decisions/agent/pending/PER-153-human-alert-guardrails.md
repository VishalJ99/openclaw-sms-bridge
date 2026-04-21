# Decision: Expose human alerts through a guarded tool
Ticket: PER-153
Timestamp: 2026-04-21T17:24:00Z

## What I decided
I added a `human_alert` OpenClaw tool for SMS and call-alert escalation, and kept actual call placement behind a localhost helper instead of embedding raw ADB shell execution in the installable plugin.

## Why
The agent needs a stronger-than-SMS notification path, but letting model input choose phone numbers or run raw `adb` commands would create unnecessary risk. Binding the recipient through plugin config and using cooldown/day-limit guardrails preserves the one-human bridge model while still allowing urgent escalation.

## Impact
Agents can learn the policy through the packaged `reach-dross` skill and use `human_alert` when enabled. The plugin package remains free of shell-execution code; operators must run the repo-local call-alert helper for `call_alert` mode to place a real ring.

## How to undo
Disable `alert.enabled` in `plugins.entries.sms-inbox-bridge.config`, remove the `human_alert` registration and `src/alert.ts`, and remove the packaged `skills/reach-dross/` directory.

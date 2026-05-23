# Decision: Expose human alerts through a bound helper tool
Date: 2026-04-21
Related tickets: PER-153
Related commits: b2c8f9e

## Context
The bridge can expose an OpenClaw tool that lets an agent reach the bound human through SMS or a stronger call/ring alert. That tool must preserve the one-trusted-human model and avoid giving model input direct control over arbitrary shell commands or phone numbers.

This promotes the agent pending decision `PER-153-human-alert-guardrails.md`.

## Decision
The plugin exposes a `human_alert` tool for SMS and call-alert escalation when enabled. The recipient is always the configured trusted `binding.phoneNumber`, and actual call placement is delegated to a repo-local localhost helper instead of embedding raw ADB shell execution in the installable plugin.

## Rationale
The agent needs a stronger-than-SMS notification path, but letting model input choose phone numbers or run raw `adb` commands would create unnecessary risk. Binding the recipient through plugin config preserves the one-human bridge model while still allowing urgent escalation. Cooldown and day-limit guardrails were intentionally removed at user request; repeated rings are controlled by agent policy and the bound-recipient restriction rather than plugin rate limits.

## Alternatives considered
- Allow arbitrary recipient numbers in `human_alert` calls.
- Embed direct ADB call commands in the OpenClaw plugin package.
- Keep plugin-owned cooldown and daily-limit rate guards.
- Disable call/ring escalation entirely and rely only on SMS.

## Scope
Applies to the packaged `human_alert` tool and the repo-local call-alert helper used by this SMS bridge. Operators must run the helper for `alert.call.mode: "local-http"` to place a real ring.

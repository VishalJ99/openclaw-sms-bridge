---
name: reach-dross
description: Use when an OpenClaw agent needs to reach Dross outside the current session through the configured SMS bridge, including normal SMS alerts or urgent call-alert escalation.
---

# Reach Dross

Use the `human_alert` tool when you need to reach Dross through the configured Android SMS bridge.

## Policy

- Use `action: "sms"` for normal async notifications, short status updates, or requests that can wait.
- Use `action: "call_alert"` only when attention is genuinely needed now: a blocker, urgent failure, safety issue, or explicit user instruction to call/ring.
- Do not include a phone number. The tool is bound to the configured trusted number.
- Always include a short `reason`.
- For `call_alert`, do not include a message body. The call is just a stronger notification/ring.
- Do not repeat `call_alert` after a block/cooldown response unless the user explicitly asks.

## Examples

SMS:

```json
{
  "action": "sms",
  "message": "OpenClaw is blocked waiting for your approval on PER-153.",
  "reason": "Need user approval to continue a blocked task"
}
```

Call alert:

```json
{
  "action": "call_alert",
  "reason": "Urgent task is blocked and user asked to be called if attention is needed"
}
```

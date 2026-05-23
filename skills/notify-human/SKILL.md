---
name: notify-human
description: Use when an agent needs to reach Dross, the human operator, outside the current session through the configured SMS bridge, including normal SMS alerts or urgent call-alert rings.
---

# Notify Human

Use this skill when you need to reach Dross outside the current session.

The configured bridge binds to one trusted human. Do not ask for, infer, or
include a phone number. The recipient is always the configured bound human.

## OpenClaw Path

When the OpenClaw `human_alert` tool is available, use it directly.

- Use `action: "sms"` for normal async notifications, short status updates, or
  requests that can wait.
- Use `action: "call_alert"` only for urgent attention, a blocker, a safety
  issue, or when the user explicitly asks for a call/ring.
- Always include a short `reason`.
- For SMS, include a short `message`.
- For `call_alert`, do not include a message body. The call is only a stronger
  notification/ring.
- Do not repeat `call_alert` unless the user explicitly asks or the situation
  remains urgent.
- If `human_alert` fails, report the failure once and do not retry
  automatically.

SMS:

```json
{
  "action": "sms",
  "message": "OpenClaw is blocked waiting for your approval.",
  "reason": "Need user approval to continue a blocked task"
}
```

Call alert:

```json
{
  "action": "call_alert",
  "reason": "User explicitly requested a test call"
}
```

## Codex / Local Shell Path

When running from Codex rather than inside OpenClaw, prefer invoking OpenClaw so
the `human_alert` guardrails and configured recipient are preserved. If the user
explicitly asks for a call test and the OpenClaw tool is unavailable, you may
test only the configured local call-alert helper. Do not construct arbitrary
phone-number commands.

Check the bridge first:

```bash
cd /Users/dross/openclaw-sms-bridge
curl -sS -o /tmp/sms-bridge-webhook.body -w 'webhook=%{http_code}\n' \
  http://127.0.0.1:18789/plugins/sms-inbox-bridge/webhook
curl -sS -o /tmp/sms-bridge-tester.body -w 'tester=%{http_code}\n' \
  http://127.0.0.1:18789/plugins/sms-inbox-bridge/tester/twilio
pnpm local:usb:start
```

Expected route status is HTTP `405` for both bridge endpoints. The USB startup
command should report Android health, host route, phone route, and webhook
registration as ready.

For call alerts, the local helper must be running:

```bash
cd /Users/dross/openclaw-sms-bridge
pnpm call-alert:server
```

The helper listens on the configured local endpoint, usually:

```text
http://127.0.0.1:18790/call-alert
```

The helper owns the ADB call command and reads the trusted phone number from
OpenClaw config. If the helper is not running, `call_alert` cannot place a real
ring even when SMS alerts are healthy.

## Troubleshooting

If SMS or call-alert delivery fails:

1. Check whether ADB sees the handset:

   ```bash
   adb devices -l
   ```

2. If no device is listed, restart ADB, unlock the phone, and accept any USB
   debugging prompt:

   ```bash
   adb kill-server
   adb start-server
   adb devices -l
   ```

3. Recreate the USB Local Server tunnels and webhook check:

   ```bash
   cd /Users/dross/openclaw-sms-bridge
   pnpm local:usb:start
   ```

For call-alert failures, confirm the helper is listening on
`127.0.0.1:18790` before retrying. Do not retry a real call repeatedly unless
the user asked for repeated rings.

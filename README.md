# openclaw-sms-bridge

`openclaw-sms-bridge` is an external OpenClaw plugin that makes one dumb-phone SMS thread behave like one specific OpenClaw session.

This is intentionally not a general SMS channel. It is a single-session inbox bridge:

- one bound phone number
- one bound parent `sessionKey`
- inbound SMS goes back into that session
- assistant transcript output from that session gets mirrored to SMS

That keeps heartbeat nudges, reminder follow-ups, and subagent progress in one conversation instead of scattering replies across separate sessions.

## Current Scope

V1 targets the official [SMS Gateway for Android](https://docs.sms-gate.app/) app from `sms-gate.app`.

Included in this scaffold:

- plugin manifest and TypeScript build/test setup
- validated plugin config
- Android gateway transport for outbound SMS and signed inbound webhook parsing
- parent-session binding helpers
- inbound queueing into a bound OpenClaw session
- outbound transcript mirroring from the bound session

Not included in V1:

- a first-class OpenClaw SMS channel
- arbitrary outbound texting
- MMS/RCS/group SMS
- multiple phone numbers
- Twilio transport

## Config Example

Put this under `plugins.entries.sms-inbox-bridge.config` in `openclaw.json`:

```json
{
  "binding": {
    "sessionKey": "agent:main:main",
    "phoneNumber": "+15551234567"
  },
  "transport": {
    "provider": "android-gateway",
    "apiBaseUrl": "https://api.sms-gate.app/3rdparty/v1",
    "username": "sms-gateway-user",
    "password": "sms-gateway-password",
    "webhookPath": "/plugins/sms-inbox-bridge/webhook",
    "webhookSigningKey": "replace-me",
    "deviceId": "optional-device-id",
    "simNumber": 1,
    "sendPriority": 100,
    "deviceActiveWithinHours": 12,
    "skipPhoneValidation": true
  },
  "outbound": {
    "maxSegmentChars": 300,
    "maxSegmentsPerReply": 6
  }
}
```

## Setup Order

You can work in parallel. The Android phone does not need to be fully integrated before the bridge code exists.

1. Install dependencies and build the plugin.
2. Install and configure the SMS Gateway for Android app on the phone.
3. Verify the SIM can send and receive a normal SMS outside OpenClaw.
4. Set a webhook signing key in the Android app.
5. Expose your OpenClaw gateway with a reachable HTTPS URL or tunnel.
6. Register an `sms:received` webhook that points at your configured `webhookPath`.
7. Enable the plugin and test one inbound SMS.

Example webhook registration against the cloud API:

```bash
curl -X POST \
  -u "username:password" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://your-openclaw-host.example/plugins/sms-inbox-bridge/webhook","event":"sms:received"}' \
  https://api.sms-gate.app/3rdparty/v1/webhooks
```

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## Notes

- Accepted architecture is recorded in [decisions/human/2026-04-16-session-bound-sms-inbox-bridge.md](./decisions/human/2026-04-16-session-bound-sms-inbox-bridge.md).
- Unknown sender handling and exact long-message behavior remain pending review in [decisions/agent/pending/](./decisions/agent/pending/).
- The bridge mirrors assistant transcript messages from the bound parent session. It does not mirror child-session transcripts directly.

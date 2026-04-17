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
- validated plugin config for Android Gateway Cloud Server and Local Server
- Android gateway transport for outbound SMS and inbound webhook parsing
- parent-session binding helpers
- inbound queueing into a bound OpenClaw session
- outbound transcript mirroring from the bound session
- native OpenClaw text slash commands over SMS when the inbound text matches a real `/command`

Not included in V1:

- a first-class OpenClaw SMS channel
- arbitrary outbound texting
- MMS/RCS/group SMS
- multiple phone numbers
- Twilio transport

## Config Example

### Cloud Server

Put this under `plugins.entries.sms-inbox-bridge.config` in `openclaw.json`:

```json
{
  "binding": {
    "sessionKey": "agent:main:main",
    "phoneNumber": "+15551234567"
  },
  "transport": {
    "provider": "android-gateway",
    "serverMode": "cloud",
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

### Local Server Over USB

This is the verified setup for the attached Android 6 phone. The Local Server API stays on the handset, and `adb` provides two tunnels:

- `adb forward tcp:18080 tcp:8080` lets OpenClaw send outbound SMS through `http://127.0.0.1:18080`
- `adb reverse tcp:3000 tcp:3000` lets the phone call back into a gateway listening on host port `3000`

```json
{
  "binding": {
    "sessionKey": "agent:main:main",
    "phoneNumber": "+15551234567"
  },
  "transport": {
    "provider": "android-gateway",
    "serverMode": "local",
    "apiBaseUrl": "http://127.0.0.1:18080",
    "username": "sms",
    "password": "replace-with-local-server-password",
    "webhookPath": "/plugins/sms-inbox-bridge/webhook",
    "deviceId": "replace-with-local-server-device-id",
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

`transport.webhookSigningKey` is required in `cloud` mode and intentionally omitted in `local` mode because the Local Server webhook API currently exposes no signing-key configuration.

## Setup Order

You can work in parallel. The Android phone does not need to be fully integrated before the bridge code exists.

1. Install dependencies and build the plugin.
2. Install and configure the SMS Gateway for Android app on the phone.
3. Verify the SIM can send and receive a normal SMS outside OpenClaw.
4. Pick one server mode:
   - `cloud`: set a webhook signing key, expose your OpenClaw gateway with HTTPS, and register an `sms:received` webhook against `https://api.sms-gate.app/3rdparty/v1/webhooks`
   - `local`: enable Local Server on the phone, create an `adb forward` for port `8080`, create an `adb reverse` from the phone back to your OpenClaw gateway port, and register an `sms:received` webhook against the phone's local API
5. Enable the plugin and test one inbound SMS.

Example webhook registration against the cloud API:

```bash
curl -X POST \
  -u "username:password" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://your-openclaw-host.example/plugins/sms-inbox-bridge/webhook","event":"sms:received"}' \
  https://api.sms-gate.app/3rdparty/v1/webhooks
```

Example Local Server workflow over USB:

```bash
adb forward tcp:18080 tcp:8080
adb reverse tcp:3000 tcp:3000

curl -X POST \
  -u "sms:replace-with-local-server-password" \
  -H "Content-Type: application/json" \
  -d '{"id":"sms-inbox-bridge","url":"http://127.0.0.1:3000/plugins/sms-inbox-bridge/webhook","event":"sms:received","deviceId":"replace-with-local-server-device-id"}' \
  http://127.0.0.1:18080/webhooks
```

Replace `3000` with the actual local port of your OpenClaw gateway. Keep the USB connection active while you use this setup; the plugin depends on the `adb` tunnels remaining up.

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
- Valid SMS text commands such as `/status` and `/new` now go through the same gateway command path as the TUI. Unknown `/...` inputs still fall back to normal prompt handling.

# openclaw-sms-bridge

## Purpose
`openclaw-sms-bridge` is an external OpenClaw plugin that binds one trusted phone number to one OpenClaw parent session so that one SMS thread behaves like one session inbox.

## Scope
In scope:
- single trusted phone number bound to one parent `sessionKey`
- inbound SMS webhook handling through SMS Gateway for Android
- outbound assistant transcript mirroring back to SMS
- external/public plugin packaging, build, and test workflow

Out of scope:
- a first-class OpenClaw SMS channel
- arbitrary outbound texting detached from a bound session
- MMS, RCS, group SMS, or multiple phone numbers
- Twilio or other alternate production transports in V1

## Key constructs
- **bound session** — the parent OpenClaw session named by `binding.sessionKey` that owns the SMS conversation
- **trusted phone number** — the one sender allowed to inject inbound turns into the bound session
- **Android gateway transport** — the transport implementation that talks to SMS Gateway for Android over its API; Cloud webhooks are signed, while Local Server webhooks are accepted unsigned over the trusted local/USB path
- **outbound mirror** — the logic that mirrors assistant transcript text from the bound session back to SMS
- **Twilio tester lane** — optional local-only test route that injects Twilio-shaped inbound events into a separate tester session and mirrors replies back to the Twilio number through Android Gateway; this is not a production transport

## Active threads
- [Linear issue PER-158] Bootstrap repo governance and set up Android SMS Gateway phone
- [Linear issue PER-153] Design session-bound SMS interface for OpenClaw via Android gateway

## How we work here
- Use Node.js 22 or newer and `pnpm`.
- Validate changes with `pnpm build`, `pnpm test`, or `pnpm check`.
- `dist/` is generated output from the TypeScript build. Do not hand-edit it.
- The plugin stays external to the main OpenClaw monorepo.
- No DVC workflow is currently used in this repository.
- For handset setup, use the official SMS Gateway for Android release artifacts from the upstream `capcom6/android-sms-gateway` project.
- Keep Twilio tester credentials in local `.env` only. Do not commit `.env`, Twilio Account SIDs, auth tokens, or phone numbers.

## Live testing
- First verify the installed plugin routes are loaded: `GET /plugins/sms-inbox-bridge/webhook` and `GET /plugins/sms-inbox-bridge/tester/twilio` should return HTTP 405 when enabled.
- Recreate Android Local Server tunnels before SMS tests with `pnpm local:usb:start`.
- For hands-off bridge smoke tests, prefer `pnpm tester:twilio --wait "Reply with exactly TESTER_OK"`. This exercises synthetic inbound parsing, OpenClaw session handling, outbound mirroring, Android Gateway send, and Twilio receipt without requiring the human to send a text.
- For hands-off physical inbound tests, use `pnpm tester:twilio --physical --wait "Reply with exactly PHYSICAL_OK"` with `SMS_BRIDGE_GATEWAY_PHONE_NUMBER` set in local `.env`. If the Android receiver is not live, use `--trigger-export` to exercise the controlled inbox-export recovery path.
- If tester config is missing after plugin reinstall, run `pnpm configure:twilio-tester` from this repo; it reads local `.env` and writes the non-repo OpenClaw config.
- Do not treat the synthetic Twilio tester as proof that the physical Android live inbound receiver works. On 2026-05-04 the attached Android 6 phone had no registered `SMS_RECEIVED` receiver for SMS Gateway; keep `inboundRecovery.enabled=true`, `catchUpOnStart=false`, and a bounded poll interval in live config unless that receiver is repaired or the handset is replaced.

## Decisions of record
- [Session-bound inbox bridge architecture](./decisions/human/2026-04-16-session-bound-sms-inbox-bridge.md)
- [Accept unsigned Android Local Server webhooks](./decisions/human/2026-04-17-local-server-unsigned-webhooks.md)
- [Expose human alerts through a bound helper tool](./decisions/human/2026-04-21-human-alert-guardrails.md)

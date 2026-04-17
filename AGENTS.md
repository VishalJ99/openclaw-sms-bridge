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
- Twilio or other alternate transports in V1

## Key constructs
- **bound session** — the parent OpenClaw session named by `binding.sessionKey` that owns the SMS conversation
- **trusted phone number** — the one sender allowed to inject inbound turns into the bound session
- **Android gateway transport** — the transport implementation that talks to SMS Gateway for Android over its API and signed webhooks
- **outbound mirror** — the logic that mirrors assistant transcript text from the bound session back to SMS

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

## Decisions of record
- [Session-bound inbox bridge architecture](./decisions/human/2026-04-16-session-bound-sms-inbox-bridge.md)

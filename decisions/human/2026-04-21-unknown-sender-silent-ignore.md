# Decision: Silently ignore unknown SMS senders
Date: 2026-04-21
Related tickets: PER-158
Related commits: c970ae2

## Context
The bridge binds one trusted phone number to one OpenClaw parent session. Inbound SMS from any other number could be a misconfiguration, a mistyped message, or an unsolicited sender probing the bridge.

This promotes the agent pending decision `PER-158-unknown-number-handling-default.md`.

## Decision
Inbound SMS from numbers that do not match `binding.phoneNumber` receive no SMS response and are not injected into the bound session. The bridge may log the ignored sender server-side for operator diagnosis.

## Rationale
Silent ignore avoids disclosing the bridge or its trusted-number policy to unknown senders. Server-side logging keeps pairing and configuration mistakes diagnosable without creating an outbound SMS side channel.

## Alternatives considered
- Reply to unknown senders with an error message.
- Forward unknown sender messages into the bound session for human review.
- Fail inbound processing when the sender does not match the trusted number.

## Scope
Applies to V1 inbound SMS webhook handling for the Android gateway transport.

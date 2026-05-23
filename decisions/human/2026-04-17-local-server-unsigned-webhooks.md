# Decision: Accept unsigned Android Local Server webhooks
Date: 2026-04-17
Related tickets: PER-158
Related commits: b4ad73e

## Context
The bridge supports SMS Gateway for Android in Cloud mode and Local Server mode. Cloud mode provides signed inbound webhooks, while the verified Local Server setup reaches the phone through USB-forwarded localhost endpoints.

This promotes the agent pending decision `PER-158-local-server-unsigned-webhooks.md`.

## Decision
For `transport.serverMode = "local"`, inbound webhooks are accepted without `x-signature` and `x-timestamp` headers. Signature verification remains required for `transport.serverMode = "cloud"`.

## Rationale
The live Local Server OpenAPI exposed through the phone's USB-forwarded endpoint includes webhook registration but no signing-key field in either the webhook schema or device settings. The on-device UI likewise exposes no signing-key control in Local Server mode. Treating Local Server callbacks as unsigned matches the observed contract and keeps the USB Local Server workflow usable.

## Alternatives considered
- Require `transport.webhookSigningKey` for Local Server anyway.
- Disable Local Server webhook ingestion until upstream signing support exists.
- Add a bridge-local signing proxy between SMS Gateway and OpenClaw.

## Scope
Applies only to Android Gateway Local Server mode. Cloud mode continues to require signed webhook headers.

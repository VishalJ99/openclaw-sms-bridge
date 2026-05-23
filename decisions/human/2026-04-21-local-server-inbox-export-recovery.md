# Decision: Add controlled Local Server inbox export recovery
Date: 2026-04-21
Related tickets: PER-158
Related commits: f243f7a

## Context
On the attached Android 6 phone, SMS Gateway can remain online and send outbound SMS while live inbound SMS broadcasts fail after reboot or background start with `Can't register receiver`. The phone still stores incoming SMS in the Android system inbox, and manually calling `/messages/inbox/export` causes SMS Gateway to emit normal `sms:received` webhooks for stored SMS.

This promotes the agent pending decision `PER-158-local-server-inbox-export-recovery.md`.

## Decision
The bridge includes an optional Local Server inbox export poller. The poller periodically asks the phone to export newly stored inbox messages so SMS Gateway can emit normal inbound webhooks for missed SMS.

## Rationale
The recovery path lets the bridge recover missed inbound SMS without relying solely on Android broadcast receiver registration. Startup catch-up remains disabled by default because replaying a historical window after gateway restarts can duplicate old replies.

## Alternatives considered
- Rely only on SMS Gateway's live broadcast receiver.
- Require manual inbox export for every missed-message incident.
- Enable startup catch-up by default.

## Scope
Applies to Local Server mode on older Android devices where live inbound receiver registration can fail. Normal operation should keep `inboundRecovery.enabled` off unless recovery is intentionally needed.

## Incident note
On 2026-04-21, enabling recovery in the live OpenClaw config before the catch-up guard was installed caused the gateway to export roughly the last hour of Android inbox SMS at startup. SMS Gateway re-emitted those stored messages as normal `sms:received` webhooks, and OpenClaw replied to them as fresh prompts.

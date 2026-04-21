# Decision: Add Local Server inbox export recovery polling
Ticket: PER-158
Timestamp: 2026-04-21T15:41:09Z

## What I decided
Add an optional inbox export poller for Android Gateway Local Server mode. The poller periodically asks the phone to export new inbox messages, which causes SMS Gateway to emit normal `sms:received` webhooks for stored SMS.

## Why
On the attached Android 6 phone, SMS Gateway remained online and could send outbound SMS, but after reboot/background start it logged `Can't register receiver` and did not process live inbound SMS broadcasts. The phone still stored the incoming SMS in the system inbox, and a manual `/messages/inbox/export` request successfully processed five missed messages and sent webhooks.

## Impact
The bridge can recover missed inbound SMS without relying solely on Android broadcast receiver registration. This is especially relevant for the old local-USB handset. Startup catch-up is disabled by default because replaying a historical window after gateway restarts can duplicate old replies.

2026-04-21 incident note: enabling recovery in the live OpenClaw config before the catch-up guard was installed caused the gateway to export roughly the last hour of Android inbox SMS at startup. SMS Gateway re-emitted those stored messages as normal `sms:received` webhooks, and OpenClaw replied to them as fresh prompts. Keep `inboundRecovery.enabled` off for normal operation until the installed plugin includes cursor/dedupe safeguards and recovery is intentionally invoked.

## How to undo
Disable the recovery polling config or remove the poller and rely only on SMS Gateway's live webhook receiver. If disabled, missed SMS after receiver-registration failures must be recovered manually through the Local Server inbox export endpoint.

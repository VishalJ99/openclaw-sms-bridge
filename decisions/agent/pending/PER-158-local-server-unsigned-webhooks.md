# Decision: Treat Android Local Server webhooks as unsigned
Ticket: PER-158
Timestamp: 2026-04-17T16:55:00Z

## What I decided
For `transport.serverMode = "local"`, the bridge will accept inbound webhooks without `x-signature` and `x-timestamp` headers. Signature verification remains required for `transport.serverMode = "cloud"`.

## Why
The live Local Server OpenAPI exposed over the phone's USB-forwarded endpoint includes webhook registration but no signing-key field in either the webhook schema or device settings, and the on-device UI likewise exposes no signing-key control in Local Server mode. That makes unsigned callbacks the best-supported interpretation of the current Local Server contract.

## Impact
This keeps the bridge compatible with the verified USB `adb forward` and `adb reverse` workflow on the Android 6 handset, but it reduces inbound authenticity guarantees for Local Server mode to local transport trust.

## How to undo
If Local Server adds signed webhooks later, require `transport.webhookSigningKey` for `local`, restore header verification in the local path, and update the README setup flow to provision the signing key before registering the webhook.

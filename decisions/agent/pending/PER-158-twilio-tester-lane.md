# Decision: Add a synthetic Twilio tester lane
Date: 2026-05-04
Related tickets: PER-158
Related commits: pending

## Context
Manual end-to-end SMS testing depended on the human sending messages from the bound dumbphone. The Android handset's live inbound receiver is also unreliable on this older device, so a tester path that depends on Twilio sending an SMS into the handset still leaves agents blocked on the same receiver problem.

## Decision
Add an optional, disabled-by-default Twilio tester lane with a separate route and session. The tester route accepts authenticated local JSON or Twilio-form-shaped input, injects it as an inbound SMS event from the Twilio number, routes it through `agent:main:sms:twilio-tester`, and mirrors assistant replies back to the Twilio number through Android Gateway outbound SMS.

## Rationale
This gives agents a repeatable hands-off smoke test for the OpenClaw inbound handler, model/session path, outbound mirror, Android Gateway send path, and Twilio receipt path without changing the production dumbphone binding or requiring human participation.

## Alternatives considered
- Keep asking the human to send dumbphone texts.
- Send Twilio SMS into the Android handset and rely on the live Android inbound receiver.
- Promote Twilio to a production transport for V1.

## Scope
The tester lane is for local verification only. It does not make Twilio a production bridge transport, and it must keep credentials in uncommitted local configuration.

# Decision: Cap mirrored assistant SMS with numbered chunks and explicit truncation
Date: 2026-04-22
Related tickets: PER-158
Related commits: c970ae2

## Context
The bridge mirrors assistant transcript output from one bound OpenClaw session back to SMS. Assistant replies can be much longer than is practical or safe to send as a burst of SMS messages.

This promotes the agent pending decision `PER-158-long-assistant-output-policy.md`.

## Decision
Mirrored assistant SMS replies are split into numbered chunks and capped by the configured `outbound.maxSegmentsPerReply`. If the assistant output exceeds the cap, the final allowed segment is marked `[truncated]`.

## Rationale
The transport layer needs a hard upper bound so one verbose assistant response cannot create an uncontrolled SMS burst. Numbering preserves readability for multipart replies, and explicit truncation tells the user that more content existed in the OpenClaw transcript.

The full assistant response remains in the bound OpenClaw session transcript, so the user can ask the agent to continue, summarize, or resend missing detail. A separate prompt-level policy can encourage SMS-session agents to answer concisely before this transport cap is reached.

## Alternatives considered
- Send every generated segment regardless of length.
- Drop long replies entirely.
- Summarize long replies automatically inside the transport layer.
- Require a separate `/more` continuation protocol before sending any additional content.

## Scope
Applies to V1 outbound assistant transcript mirroring over SMS. It does not settle any future agent prompt policy for concise SMS responses.

# Decision: Build the SMS bridge as a session-bound inbox, not a first-class channel
Date: 2026-04-16
Related tickets: PER-153, PER-155
Related commits: none yet

## Context
The goal is to make one dumb-phone SMS thread behave like one OpenClaw conversation without expanding OpenClaw itself into a general SMS product surface.

## Decision
Bind one trusted phone number to one parent OpenClaw `sessionKey`. Inject inbound SMS from that number back into that same session as user turns, and mirror assistant transcript output from that parent session back out over SMS. Use SMS Gateway for Android as the first transport, behind a narrow transport interface that can support a later backend such as Twilio.

## Rationale
This is the least-complex architecture that still preserves the illusion of one ongoing session on the phone. It avoids the extra session lifecycle, routing, and product-surface work required by a first-class SMS channel while keeping the transport boundary replaceable.

## Alternatives considered
- A first-class OpenClaw SMS channel with its own session model.
- A general outbound texting tool that is not bound to one parent session.
- Shipping the plugin inside the main OpenClaw repository instead of keeping it external/public.

## Scope
Applies to the V1 plugin architecture, config surface, inbound webhook behavior, and outbound transcript mirroring in this repository.

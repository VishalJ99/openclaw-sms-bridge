# Decision: Preserve silent ignore for unknown inbound numbers until reviewed
Ticket: PER-158
Timestamp: 2026-04-17T14:10:55Z

## What I decided
I preserved the scaffold's current behavior of silently ignoring inbound SMS from numbers other than the configured trusted phone number while migrating the legacy decision log into the review queue.

## Why
This behavior already exists in the code and was explicitly listed as pending review in the legacy `DECISIONS.md`. Migrating it into `decisions/agent/pending/` keeps the review queue intact without promoting the choice to a human decision prematurely.

## Impact
This affects how unauthorized or mistyped senders experience the bridge. The current behavior avoids disclosing bridge details to unknown numbers, but it may also hide misconfiguration or pairing mistakes.

## How to undo
Change unknown-sender handling in `src/inbound.ts`, update tests and docs to match the new policy, and then archive or replace this pending decision.

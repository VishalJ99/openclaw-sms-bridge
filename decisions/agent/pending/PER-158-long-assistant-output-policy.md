# Decision: Preserve chunk-and-truncate outbound SMS behavior until reviewed
Ticket: PER-158
Timestamp: 2026-04-17T14:10:55Z

## What I decided
I preserved the scaffold's current outbound policy of numbering multipart replies and truncating once the configured segment cap is reached while migrating the legacy decision log into the review queue.

## Why
This behavior is already implemented and tested, and the legacy `DECISIONS.md` called it out as pending review rather than settled policy. Keeping it pending preserves traceability without re-deciding the UX during governance bootstrap.

## Impact
This affects how long assistant replies are presented over SMS and whether the user sees full text versus a shortened result. It also constrains future work on summary-first or follow-up-based long-message handling.

## How to undo
Change `chunkSmsText` behavior in `src/outbound.ts`, adjust the outbound tests and README to match, and then archive or replace this pending decision.

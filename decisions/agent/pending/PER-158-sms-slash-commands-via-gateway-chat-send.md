# Decision: Route valid SMS slash commands through the gateway chat path
Ticket: PER-158
Timestamp: 2026-04-17T17:55:00Z

## What I decided
When an inbound SMS body starts with `/` and matches a real OpenClaw text command, the bridge routes it through the gateway's authenticated `chat.send` path instead of passing it to `runEmbeddedAgent()` as a prompt.

## Why
OpenClaw already owns slash-command behavior, including command availability, `/new` session rotation, and command-specific replies. Re-implementing command parsing in the plugin would drift from the TUI/web behavior and would miss future command additions.

## Impact
SMS now inherits native slash-command behavior for supported text commands such as `/status` and `/new`, while unknown slash-looking inputs still fall back to normal prompt handling.

## How to undo
Remove the gateway-backed slash-command routing helper and revert `src/inbound.ts` to always call `runEmbeddedAgent()` with the raw SMS text.

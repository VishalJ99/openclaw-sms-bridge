# Decision: Route valid SMS slash commands through gateway chat
Date: 2026-04-17
Related tickets: PER-158
Related commits: ed95f00

## Context
Inbound SMS text can contain OpenClaw slash commands such as `/status` or `/new`. The bridge can either treat those messages as normal prompts or pass supported commands through the same gateway command path used by native OpenClaw clients.

This promotes the agent pending decision `PER-158-sms-slash-commands-via-gateway-chat-send.md`.

## Decision
When an inbound SMS body starts with `/` and matches a real OpenClaw text command, the bridge routes it through the gateway's authenticated `chat.send` path instead of passing it to `runEmbeddedAgent()` as a prompt. Unknown slash-looking messages still fall back to normal prompt handling.

## Rationale
OpenClaw already owns slash-command behavior, including command availability, `/new` session rotation, and command-specific replies. Re-implementing command parsing in the plugin would drift from TUI/web behavior and would miss future command additions.

## Alternatives considered
- Treat all SMS slash-looking text as ordinary prompts.
- Implement a separate SMS-only slash-command parser in the plugin.
- Reject all slash-looking SMS input.

## Scope
Applies to V1 inbound SMS handling for supported text commands. It does not make unknown slash-looking text an error.

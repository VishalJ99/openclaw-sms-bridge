import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { ResolvedSmsBridgePluginConfig } from "./config.js";
import type { SmsTransport } from "./transport/types.js";

type TranscriptMessage = {
  role?: unknown;
  content?: unknown;
};

export type SessionTranscriptUpdateLike = {
  sessionKey?: string;
  message?: unknown;
  messageId?: string;
};

export function extractAssistantText(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const candidate = message as TranscriptMessage;
  if (candidate.role !== "assistant") {
    return null;
  }
  if (typeof candidate.content === "string") {
    const trimmed = candidate.content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (!Array.isArray(candidate.content)) {
    return null;
  }
  const parts = candidate.content
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const typed = entry as { type?: unknown; text?: unknown };
      if (typed.type !== "text" || typeof typed.text !== "string") {
        return [];
      }
      const trimmed = typed.text.trim();
      return trimmed.length > 0 ? [trimmed] : [];
    })
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function splitText(text: string, maxChars: number): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    if (normalized.length - cursor <= maxChars) {
      chunks.push(normalized.slice(cursor).trim());
      break;
    }
    const slice = normalized.slice(cursor, cursor + maxChars + 1);
    const breakAt = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
    const offset = breakAt > Math.floor(maxChars * 0.6) ? breakAt : maxChars;
    chunks.push(normalized.slice(cursor, cursor + offset).trim());
    cursor += offset;
    while (normalized[cursor] === " " || normalized[cursor] === "\n") {
      cursor += 1;
    }
  }
  return chunks.filter((chunk) => chunk.length > 0);
}

function numberingPrefix(index: number, total: number): string {
  return `(${String(index)}/${String(total)}) `;
}

function trimToFit(value: string, maxChars: number, suffix: string): string {
  if (value.length + suffix.length <= maxChars) {
    return value;
  }
  const budget = Math.max(0, maxChars - suffix.length - 1);
  return `${value.slice(0, budget).trimEnd()}…${suffix}`;
}

export function chunkSmsText(params: {
  maxSegmentChars: number;
  maxSegmentsPerReply: number;
  text: string;
}): string[] {
  const trimmed = params.text.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.length <= params.maxSegmentChars) {
    return [trimmed];
  }

  const bodyLimit = Math.max(20, params.maxSegmentChars - numberingPrefix(1, 9).length);
  const rawChunks = splitText(trimmed, bodyLimit);
  const limitedChunks =
    rawChunks.length > params.maxSegmentsPerReply
      ? [
          ...rawChunks.slice(0, Math.max(0, params.maxSegmentsPerReply - 1)),
          trimToFit(
            rawChunks[params.maxSegmentsPerReply - 1] ?? "",
            bodyLimit,
            " [truncated]",
          ),
        ]
      : rawChunks;

  if (limitedChunks.length <= 1) {
    return limitedChunks;
  }

  return limitedChunks.map(
    (chunk, index) => `${numberingPrefix(index + 1, limitedChunks.length)}${chunk}`,
  );
}

type SmsOutboundMirrorParams = {
  logger: PluginLogger;
  pluginConfig: ResolvedSmsBridgePluginConfig;
  transport: SmsTransport;
};

export class SmsOutboundMirror {
  private readonly sentMessageIds = new Set<string>();
  private readonly sentMessageOrder: string[] = [];
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly params: SmsOutboundMirrorParams) {}

  handleTranscriptUpdate(update: SessionTranscriptUpdateLike): void {
    if (update.sessionKey !== this.params.pluginConfig.binding.sessionKey) {
      return;
    }
    if (update.messageId && this.sentMessageIds.has(update.messageId)) {
      return;
    }

    const text = extractAssistantText(update.message);
    if (!text) {
      return;
    }

    this.tail = this.tail
      .catch(() => undefined)
      .then(async () => {
        const chunks = chunkSmsText({
          text,
          maxSegmentChars: this.params.pluginConfig.outbound.maxSegmentChars,
          maxSegmentsPerReply: this.params.pluginConfig.outbound.maxSegmentsPerReply,
        });
        for (const chunk of chunks) {
          await this.params.transport.sendText({
            text: chunk,
            to: this.params.pluginConfig.binding.phoneNumber,
            idempotencyKey: update.messageId,
          });
        }
        if (update.messageId) {
          this.recordSentMessage(update.messageId);
        }
      })
      .catch((error) => {
        this.params.logger.error(
          `sms-inbox-bridge failed to mirror assistant message ${
            update.messageId ?? "<unknown>"
          }: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  private recordSentMessage(messageId: string): void {
    this.sentMessageIds.add(messageId);
    this.sentMessageOrder.push(messageId);
    while (this.sentMessageOrder.length > 500) {
      const removed = this.sentMessageOrder.shift();
      if (removed) {
        this.sentMessageIds.delete(removed);
      }
    }
  }
}

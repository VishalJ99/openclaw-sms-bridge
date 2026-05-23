import fs from "node:fs";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { ResolvedSmsBridgePluginConfig } from "./config.js";
import type { SmsTransport } from "./transport/types.js";

type TranscriptMessage = {
  role?: unknown;
  content?: unknown;
};

export type SessionTranscriptUpdateLike = {
  sessionFile?: string;
  sessionKey?: string;
  message?: unknown;
  messageId?: string;
};

type BoundSessionReference = {
  sessionFile?: string;
  sessionKey?: string;
};

type AssistantTranscriptMessage = {
  message: unknown;
  messageId?: string;
};

const SESSION_FILE_TAIL_BYTES = 1024 * 1024;

export function matchesBoundSessionUpdate(
  update: SessionTranscriptUpdateLike,
  boundSession: BoundSessionReference,
): boolean {
  const boundSessionKey =
    typeof boundSession.sessionKey === "string" ? boundSession.sessionKey.trim() : "";
  const updateSessionKey =
    typeof update.sessionKey === "string" ? update.sessionKey.trim() : "";
  if (boundSessionKey && updateSessionKey && boundSessionKey === updateSessionKey) {
    return true;
  }

  const boundSessionFile =
    typeof boundSession.sessionFile === "string" ? boundSession.sessionFile.trim() : "";
  const updateSessionFile =
    typeof update.sessionFile === "string" ? update.sessionFile.trim() : "";
  return Boolean(boundSessionFile && updateSessionFile && boundSessionFile === updateSessionFile);
}

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

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readSessionFileTail(sessionFile: string): string | null {
  const trimmed = sessionFile.trim();
  if (!trimmed) {
    return null;
  }
  let fd: number | undefined;
  try {
    const stat = fs.statSync(trimmed);
    if (!stat.isFile() || stat.size <= 0) {
      return null;
    }
    const bytesToRead = Math.min(stat.size, SESSION_FILE_TAIL_BYTES);
    const start = Math.max(0, stat.size - bytesToRead);
    const buffer = Buffer.alloc(bytesToRead);
    fd = fs.openSync(trimmed, "r");
    fs.readSync(fd, buffer, 0, bytesToRead, start);
    return buffer.toString("utf8");
  } catch {
    return null;
  } finally {
    if (typeof fd === "number") {
      fs.closeSync(fd);
    }
  }
}

export function readLatestAssistantMessageFromSessionFile(
  sessionFile: string,
): AssistantTranscriptMessage | null {
  const tail = readSessionFileTail(sessionFile);
  if (!tail) {
    return null;
  }
  const lines = tail.split(/\r?\n/).filter((line) => line.trim().length > 0).reverse();
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") {
      continue;
    }
    const entry = parsed as {
      id?: unknown;
      message?: unknown;
      type?: unknown;
    };
    const message = entry.type === "message" ? entry.message : parsed;
    if (!extractAssistantText(message)) {
      continue;
    }
    return {
      message,
      ...(normalizeOptionalString(entry.id)
        ? { messageId: normalizeOptionalString(entry.id) }
        : {}),
    };
  }
  return null;
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
  resolveBoundSession: () => BoundSessionReference;
  pluginConfig: ResolvedSmsBridgePluginConfig;
  transport: SmsTransport;
};

export class SmsOutboundMirror {
  private readonly sentMessageIds = new Set<string>();
  private readonly sentMessageOrder: string[] = [];
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly params: SmsOutboundMirrorParams) {}

  handleTranscriptUpdate(update: SessionTranscriptUpdateLike): void {
    if (!matchesBoundSessionUpdate(update, this.params.resolveBoundSession())) {
      return;
    }
    if (update.messageId && this.sentMessageIds.has(update.messageId)) {
      return;
    }

    const resolved =
      update.message !== undefined
        ? { message: update.message, messageId: update.messageId }
        : update.sessionFile
          ? readLatestAssistantMessageFromSessionFile(update.sessionFile)
          : null;
    if (resolved?.messageId && this.sentMessageIds.has(resolved.messageId)) {
      return;
    }

    const text = extractAssistantText(resolved?.message);
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
            idempotencyKey: resolved?.messageId,
          });
        }
        if (resolved?.messageId) {
          this.recordSentMessage(resolved.messageId);
        }
      })
      .catch((error) => {
        this.params.logger.error(
          `sms-inbox-bridge failed to mirror assistant message ${
            resolved?.messageId ?? update.messageId ?? "<unknown>"
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

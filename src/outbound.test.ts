import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  SmsOutboundMirror,
  chunkSmsText,
  extractAssistantText,
  matchesBoundSessionUpdate,
  readLatestAssistantMessageFromSessionFile,
} from "./outbound.js";

function createPluginConfig() {
  return {
    binding: {
      phoneNumber: "+447981839872",
      sessionKey: "agent:main:sms:android-gateway",
    },
    outbound: {
      maxSegmentChars: 160,
      maxSegmentsPerReply: 3,
    },
  };
}

describe("extractAssistantText", () => {
  it("extracts plain assistant text content", () => {
    expect(
      extractAssistantText({
        role: "assistant",
        content: [
          { type: "text", text: "first" },
          { type: "text", text: "second" },
        ],
      }),
    ).toBe("first\n\nsecond");
  });

  it("ignores non-assistant transcript messages", () => {
    expect(
      extractAssistantText({
        role: "user",
        content: [{ type: "text", text: "hello" }],
      }),
    ).toBeNull();
  });
});

describe("matchesBoundSessionUpdate", () => {
  it("matches updates by session key", () => {
    expect(
      matchesBoundSessionUpdate(
        { sessionKey: "agent:main:sms:android-gateway" },
        { sessionKey: "agent:main:sms:android-gateway", sessionFile: "/tmp/a.jsonl" },
      ),
    ).toBe(true);
  });

  it("matches updates by session file when session key is absent", () => {
    expect(
      matchesBoundSessionUpdate(
        { sessionFile: "/tmp/sms-session.jsonl" },
        {
          sessionKey: "agent:main:sms:android-gateway",
          sessionFile: "/tmp/sms-session.jsonl",
        },
      ),
    ).toBe(true);
  });
});

describe("SmsOutboundMirror", () => {
  it("mirrors gateway-injected assistant replies identified by session file", async () => {
    const sendText = vi.fn(async () => ({ accepted: true }));
    const mirror = new SmsOutboundMirror({
      logger: {
        error: vi.fn(),
      } as never,
      pluginConfig: createPluginConfig() as never,
      resolveBoundSession: () => ({
        sessionKey: "agent:main:sms:android-gateway",
        sessionFile: "/tmp/sms-session.jsonl",
      }),
      transport: {
        sendText,
      },
    });

    mirror.handleTranscriptUpdate({
      sessionFile: "/tmp/sms-session.jsonl",
      messageId: "msg-123",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "status output" }],
      },
    });

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledWith({
        idempotencyKey: "msg-123",
        text: "status output",
        to: "+447981839872",
      });
    });
  });

  it("mirrors file-only transcript updates from the latest assistant message", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sms-outbound-"));
    const sessionFile = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "message",
          id: "user-1",
          message: { role: "user", content: "ping" },
        }),
        JSON.stringify({
          type: "message",
          id: "assistant-1",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "pong" }],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    const sendText = vi.fn(async () => ({ accepted: true }));
    const mirror = new SmsOutboundMirror({
      logger: {
        error: vi.fn(),
      } as never,
      pluginConfig: createPluginConfig() as never,
      resolveBoundSession: () => ({
        sessionKey: "agent:main:sms:android-gateway",
        sessionFile,
      }),
      transport: {
        sendText,
      },
    });

    mirror.handleTranscriptUpdate({
      sessionFile,
      sessionKey: "agent:main:sms:android-gateway",
    });

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledWith({
        idempotencyKey: "assistant-1",
        text: "pong",
        to: "+447981839872",
      });
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("readLatestAssistantMessageFromSessionFile", () => {
  it("returns the newest assistant message from a JSONL transcript", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sms-transcript-"));
    const sessionFile = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "message",
          id: "assistant-old",
          message: { role: "assistant", content: [{ type: "text", text: "old" }] },
        }),
        JSON.stringify({
          type: "message",
          id: "user-new",
          message: { role: "user", content: "ignore me" },
        }),
        JSON.stringify({
          type: "message",
          id: "assistant-new",
          message: { role: "assistant", content: [{ type: "text", text: "new" }] },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const latest = readLatestAssistantMessageFromSessionFile(sessionFile);

    expect(latest?.messageId).toBe("assistant-new");
    expect(extractAssistantText(latest?.message)).toBe("new");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("chunkSmsText", () => {
  it("numbers multi-part replies", () => {
    const chunks = chunkSmsText({
      text: "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu",
      maxSegmentChars: 24,
      maxSegmentsPerReply: 4,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.startsWith("(1/")).toBe(true);
  });

  it("truncates at the configured segment cap", () => {
    const chunks = chunkSmsText({
      text: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen",
      maxSegmentChars: 20,
      maxSegmentsPerReply: 2,
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toContain("[truncated]");
  });
});

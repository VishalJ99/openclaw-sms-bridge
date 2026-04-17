import { describe, expect, it } from "vitest";
import { chunkSmsText, extractAssistantText } from "./outbound.js";

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

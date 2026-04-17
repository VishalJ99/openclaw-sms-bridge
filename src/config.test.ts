import { describe, expect, it } from "vitest";
import { resolveSmsBridgePluginConfig } from "./config.js";

describe("resolveSmsBridgePluginConfig", () => {
  it("applies defaults and normalizes the trusted phone number", () => {
    const resolved = resolveSmsBridgePluginConfig({
      binding: {
        phoneNumber: " +1 (555) 123-4567 ",
      },
      transport: {
        username: "user",
        password: "pass",
        webhookSigningKey: "secret",
      },
    });

    expect(resolved.binding).toEqual({
      phoneNumber: "+15551234567",
      sessionKey: "agent:main:main",
    });
    expect(resolved.transport.provider).toBe("android-gateway");
    expect(resolved.transport.webhookPath).toBe("/plugins/sms-inbox-bridge/webhook");
    expect(resolved.outbound).toEqual({
      maxSegmentChars: 300,
      maxSegmentsPerReply: 6,
    });
  });

  it("throws when required transport credentials are missing", () => {
    expect(() =>
      resolveSmsBridgePluginConfig({
        binding: {
          phoneNumber: "+15551234567",
        },
        transport: {
          password: "pass",
          webhookSigningKey: "secret",
        },
      }),
    ).toThrow("transport.username");
  });
});

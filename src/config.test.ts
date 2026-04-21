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
    expect(resolved.transport.serverMode).toBe("cloud");
    expect(resolved.transport.webhookPath).toBe("/plugins/sms-inbox-bridge/webhook");
    expect(resolved.outbound).toEqual({
      maxSegmentChars: 300,
      maxSegmentsPerReply: 6,
    });
    expect(resolved.inboundRecovery).toEqual({
      enabled: false,
      catchUpOnStart: false,
      pollIntervalMs: 30_000,
      lookbackMinutes: 60,
      safetyLagMs: 5_000,
    });
  });

  it("allows local server mode without a webhook signing key", () => {
    const resolved = resolveSmsBridgePluginConfig({
      binding: {
        phoneNumber: "+15551234567",
      },
      transport: {
        serverMode: "local",
        apiBaseUrl: "http://127.0.0.1:18080",
        username: "sms",
        password: "pass",
      },
    });

    expect(resolved.transport).toMatchObject({
      serverMode: "local",
      apiBaseUrl: "http://127.0.0.1:18080",
      username: "sms",
      password: "pass",
    });
    expect(resolved.transport.webhookSigningKey).toBeUndefined();
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

  it("requires a webhook signing key in cloud mode", () => {
    expect(() =>
      resolveSmsBridgePluginConfig({
        binding: {
          phoneNumber: "+15551234567",
        },
        transport: {
          username: "user",
          password: "pass",
        },
      }),
    ).toThrow("transport.webhookSigningKey");
  });

  it("supports bounded inbox export recovery settings", () => {
    const resolved = resolveSmsBridgePluginConfig({
      binding: {
        phoneNumber: "+15551234567",
      },
      transport: {
        serverMode: "local",
        apiBaseUrl: "http://127.0.0.1:18080",
        username: "sms",
        password: "pass",
      },
      inboundRecovery: {
        enabled: true,
        catchUpOnStart: true,
        pollIntervalMs: 45_000,
        lookbackMinutes: 120,
        safetyLagMs: 10_000,
      },
    });

    expect(resolved.inboundRecovery).toEqual({
      enabled: true,
      catchUpOnStart: true,
      pollIntervalMs: 45_000,
      lookbackMinutes: 120,
      safetyLagMs: 10_000,
    });
  });
});

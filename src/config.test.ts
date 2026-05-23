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
    expect(resolved.alert).toEqual({
      enabled: false,
      sms: {
        enabled: true,
        maxChars: 300,
      },
      call: {
        enabled: false,
        mode: "disabled",
        endpointUrl: "http://127.0.0.1:18790/call-alert",
        ringSeconds: 8,
      },
    });
    expect(resolved.tester).toEqual({
      enabled: false,
      routePath: "/plugins/sms-inbox-bridge/tester/twilio",
      sessionKey: "agent:main:sms:twilio-tester",
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

  it("supports guarded human alert settings", () => {
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
      alert: {
        enabled: true,
        sms: {
          enabled: true,
          maxChars: 240,
        },
        call: {
          enabled: true,
          mode: "local-http",
          endpointUrl: "http://127.0.0.1:18790/call-alert",
          bearerToken: "secret-token",
          ringSeconds: 10,
        },
      },
    });

    expect(resolved.alert).toEqual({
      enabled: true,
      sms: {
        enabled: true,
        maxChars: 240,
      },
      call: {
        enabled: true,
        mode: "local-http",
        endpointUrl: "http://127.0.0.1:18790/call-alert",
        bearerToken: "secret-token",
        ringSeconds: 10,
      },
    });
  });

  it("supports an enabled Twilio tester lane", () => {
    const resolved = resolveSmsBridgePluginConfig({
      binding: {
        sessionKey: "agent:assistant:sms:android-gateway",
        phoneNumber: "+15551234567",
      },
      transport: {
        serverMode: "local",
        apiBaseUrl: "http://127.0.0.1:18080",
        username: "sms",
        password: "pass",
      },
      tester: {
        enabled: true,
        phoneNumber: " +44 7360 543151 ",
        sharedSecret: "tester-secret",
        twilio: {
          accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
          authToken: "auth-token",
          fromNumber: "+44 7360 543151",
        },
      },
    });

    expect(resolved.tester).toEqual({
      enabled: true,
      routePath: "/plugins/sms-inbox-bridge/tester/twilio",
      sessionKey: "agent:assistant:sms:twilio-tester",
      phoneNumber: "+447360543151",
      sharedSecret: "tester-secret",
      twilio: {
        accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        authToken: "auth-token",
        fromNumber: "+447360543151",
      },
    });
  });

  it("requires Twilio tester credentials when the tester is enabled", () => {
    expect(() =>
      resolveSmsBridgePluginConfig({
        binding: {
          phoneNumber: "+15551234567",
        },
        transport: {
          serverMode: "local",
          apiBaseUrl: "http://127.0.0.1:18080",
          username: "sms",
          password: "pass",
        },
        tester: {
          enabled: true,
          phoneNumber: "+447360543151",
          sharedSecret: "tester-secret",
        },
      }),
    ).toThrow("tester.twilio.accountSid");
  });
});

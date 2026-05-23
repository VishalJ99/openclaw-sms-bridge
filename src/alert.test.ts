import { describe, expect, it, vi } from "vitest";
import { createHumanAlertTool } from "./alert.js";
import type { ResolvedSmsBridgePluginConfig } from "./config.js";

function createPluginConfig(
  alert: Partial<ResolvedSmsBridgePluginConfig["alert"]> = {},
): ResolvedSmsBridgePluginConfig {
  return {
    binding: {
      phoneNumber: "+447981839872",
      sessionKey: "agent:main:sms:android-gateway",
    },
    transport: {
      provider: "android-gateway",
      serverMode: "local",
      apiBaseUrl: "http://127.0.0.1:18080",
      username: "sms",
      password: "pass",
      webhookPath: "/plugins/sms-inbox-bridge/webhook",
      sendPriority: 100,
      deviceActiveWithinHours: 12,
      skipPhoneValidation: true,
    },
    inboundRecovery: {
      enabled: false,
      catchUpOnStart: false,
      pollIntervalMs: 30_000,
      lookbackMinutes: 60,
      safetyLagMs: 5_000,
    },
    alert: {
      enabled: true,
      sms: {
        enabled: true,
        maxChars: 300,
      },
      call: {
        enabled: true,
        mode: "dry-run",
        endpointUrl: "http://127.0.0.1:18790/call-alert",
        ringSeconds: 8,
      },
      ...alert,
    },
    outbound: {
      maxSegmentChars: 300,
      maxSegmentsPerReply: 6,
    },
    tester: {
      enabled: false,
      routePath: "/plugins/sms-inbox-bridge/tester/twilio",
      sessionKey: "agent:main:sms:twilio-tester",
    },
  };
}

describe("createHumanAlertTool", () => {
  it("sends SMS only to the configured bound number", async () => {
    const sendText = vi.fn(async () => ({
      accepted: true,
      providerMessageId: "message-1",
    }));
    const tool = createHumanAlertTool({
      logger: { info: vi.fn() } as never,
      pluginConfig: createPluginConfig(),
      transport: { sendText },
    });

    const result = await tool.execute("tool-call-1", {
      action: "sms",
      message: "Need approval on PER-153.",
      reason: "approval needed",
    });

    expect(sendText).toHaveBeenCalledWith({
      idempotencyKey: expect.stringMatching(/^human-alert-/),
      text: "Need approval on PER-153.",
      to: "+447981839872",
    });
    expect(result.details).toEqual({
      action: "sms",
      status: "sent",
      providerMessageId: "message-1",
    });
  });

  it("requests call alerts through the configured local helper without sending a recipient", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));
    const tool = createHumanAlertTool({
      fetchImpl,
      logger: { warn: vi.fn() } as never,
      now: () => Date.parse("2026-04-21T17:00:00.000Z"),
      pluginConfig: createPluginConfig({
        call: {
          enabled: true,
          mode: "local-http",
          endpointUrl: "http://127.0.0.1:18790/call-alert",
          bearerToken: "secret-token",
          ringSeconds: 8,
        },
      }),
      transport: { sendText: vi.fn() },
    });

    const result = await tool.execute("tool-call-1", {
      action: "call_alert",
      reason: "urgent blocker",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:18790/call-alert");
    expect(init.headers).toMatchObject({
      authorization: "Bearer secret-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      reason: "urgent blocker",
      requestedAt: "2026-04-21T17:00:00.000Z",
    });
    expect(String(init.body)).not.toContain("+447981839872");
    expect(result.details).toEqual({
      action: "call_alert",
      status: "requested",
      reason: "urgent blocker",
    });
  });

  it("surfaces dry-run responses from the local helper", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: "dry-run" }), {
          status: 202,
          headers: { "content-type": "application/json" },
        }),
    );
    const tool = createHumanAlertTool({
      fetchImpl,
      logger: { warn: vi.fn() } as never,
      pluginConfig: createPluginConfig({
        call: {
          enabled: true,
          mode: "local-http",
          endpointUrl: "http://127.0.0.1:18790/call-alert",
          ringSeconds: 8,
        },
      }),
      transport: { sendText: vi.fn() },
    });

    const result = await tool.execute("tool-call-1", {
      action: "call_alert",
      reason: "smoke test",
    });

    expect(result.details).toEqual({
      action: "call_alert",
      status: "dry-run",
      reason: "smoke test",
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { ResolvedSmsBridgePluginConfig } from "./config.js";
import { SmsInboundHandler } from "./inbound.js";

const mocks = vi.hoisted(() => ({
  routeGatewayTextSlashCommandIfSupportedMock: vi.fn(),
}));

vi.mock("./slash-commands.js", () => ({
  routeGatewayTextSlashCommandIfSupported: mocks.routeGatewayTextSlashCommandIfSupportedMock,
}));

function buildRuntime() {
  const sessionStore: Record<string, Record<string, unknown>> = {};
  const runtime = {
    agent: {
      ensureAgentWorkspace: vi.fn(async () => undefined),
      resolveAgentDir: vi.fn(() => "/tmp/openclaw-agent"),
      resolveAgentTimeoutMs: vi.fn(() => 30_000),
      resolveAgentWorkspaceDir: vi.fn(() => "/tmp/openclaw-workspace"),
      runEmbeddedAgent: vi.fn(async () => undefined),
      session: {
        resolveStorePath: vi.fn(() => "/tmp/openclaw-session-store.json"),
        loadSessionStore: vi.fn(() => sessionStore),
        saveSessionStore: vi.fn(async (_path: string, nextStore: Record<string, unknown>) => {
          for (const key of Object.keys(sessionStore)) {
            delete sessionStore[key];
          }
          Object.assign(sessionStore, nextStore);
        }),
        resolveSessionFilePath: vi.fn(
          (sessionId: string) => `/tmp/openclaw-sessions/${sessionId}.jsonl`,
        ),
      },
    },
  };
  return { runtime, sessionStore };
}

const pluginConfig: ResolvedSmsBridgePluginConfig = {
  binding: {
    sessionKey: "agent:main:sms:android-gateway",
    phoneNumber: "+447981839872",
  },
  transport: {
    provider: "android-gateway",
    serverMode: "local",
    apiBaseUrl: "http://127.0.0.1:18080",
    username: "sms",
    password: "secret",
    webhookPath: "/plugins/sms-inbox-bridge/webhook",
    deviceId: "device-id",
    simNumber: 1,
    sendPriority: 100,
    deviceActiveWithinHours: 12,
    skipPhoneValidation: true,
  },
  outbound: {
    maxSegmentChars: 300,
    maxSegmentsPerReply: 6,
  },
  inboundRecovery: {
    enabled: false,
    catchUpOnStart: false,
    pollIntervalMs: 30_000,
    lookbackMinutes: 60,
    safetyLagMs: 5_000,
  },
};

const config: OpenClawConfig = {
  gateway: {
    auth: {
      mode: "token",
      token: "gateway-token",
    },
  },
  agents: {
    defaults: {
      model: {
        primary: "openai-codex/gpt-5.4",
      },
    },
  },
};

const logger: PluginLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("SmsInboundHandler", () => {
  beforeEach(() => {
    mocks.routeGatewayTextSlashCommandIfSupportedMock.mockReset();
    vi.clearAllMocks();
  });

  it("routes supported slash commands through the gateway instead of the embedded agent", async () => {
    mocks.routeGatewayTextSlashCommandIfSupportedMock.mockResolvedValue(true);
    const { runtime } = buildRuntime();
    const handler = new SmsInboundHandler({
      config,
      logger,
      onProcessingError: vi.fn(async () => undefined),
      pluginConfig,
      runtime: runtime as never,
    });

    handler.enqueue({
      externalId: "sms-status-1",
      from: "+447981839872",
      receivedAt: Date.now(),
      text: "/status",
    });

    await vi.waitFor(() => {
      expect(mocks.routeGatewayTextSlashCommandIfSupportedMock).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "main",
          message: "/status",
          runId: "sms-status-1",
          sessionKey: "agent:main:sms:android-gateway",
        }),
      );
    });
    expect(runtime.agent.runEmbeddedAgent).not.toHaveBeenCalled();
  });

  it("falls back to embedded-agent prompt delivery for unknown slash-looking text", async () => {
    mocks.routeGatewayTextSlashCommandIfSupportedMock.mockResolvedValue(false);
    const { runtime } = buildRuntime();
    const handler = new SmsInboundHandler({
      config,
      logger,
      onProcessingError: vi.fn(async () => undefined),
      pluginConfig,
      runtime: runtime as never,
    });

    handler.enqueue({
      externalId: "sms-unknown-1",
      from: "+447981839872",
      receivedAt: Date.now(),
      text: "/statusish",
    });

    await vi.waitFor(() => {
      expect(runtime.agent.runEmbeddedAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "/statusish",
          provider: "openai-codex",
          model: "gpt-5.4",
          sessionKey: "agent:main:sms:android-gateway",
        }),
      );
    });
  });
});

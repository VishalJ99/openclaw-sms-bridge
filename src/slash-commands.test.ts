import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestMock: vi.fn(),
  startMock: vi.fn(),
  stopMock: vi.fn(),
  stopAndWaitMock: vi.fn(async () => undefined),
  gatewayCtorMock: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/gateway-runtime", () => ({
  GatewayClient: mocks.gatewayCtorMock.mockImplementation((opts: { onHelloOk?: () => void }) => ({
    start: () => {
      mocks.startMock();
      queueMicrotask(() => opts.onHelloOk?.());
    },
    stop: mocks.stopMock,
    stopAndWait: mocks.stopAndWaitMock,
    request: mocks.requestMock,
  })),
}));

import {
  isSupportedTextSlashCommand,
  matchesTextSlashCommand,
  resolveGatewayLoopbackConnection,
  routeGatewayTextSlashCommandIfSupported,
} from "./slash-commands.js";

describe("slash command matching", () => {
  it("matches exact text aliases", () => {
    expect(
      matchesTextSlashCommand("/status", {
        textAliases: ["/status"],
        acceptsArgs: false,
      }),
    ).toBe(true);
  });

  it("matches arg-taking aliases with trailing arguments", () => {
    expect(
      matchesTextSlashCommand("/model openai-codex/gpt-5.4", {
        textAliases: ["/model", "/m"],
        acceptsArgs: true,
      }),
    ).toBe(true);
  });

  it("does not treat unknown slash text as a supported command", () => {
    expect(
      isSupportedTextSlashCommand("/unknown test", [
        {
          textAliases: ["/status"],
          acceptsArgs: false,
        },
      ]),
    ).toBe(false);
  });
});

describe("gateway-backed slash routing", () => {
  beforeEach(() => {
    mocks.requestMock.mockReset();
    mocks.startMock.mockReset();
    mocks.stopMock.mockReset();
    mocks.stopAndWaitMock.mockReset().mockResolvedValue(undefined);
    mocks.gatewayCtorMock.mockClear();
  });

  it("routes supported text slash commands through commands.list and chat.send", async () => {
    mocks.requestMock
      .mockResolvedValueOnce({
        commands: [{ textAliases: ["/status"], acceptsArgs: false }],
      })
      .mockResolvedValueOnce({ status: "ok" });

    const routed = await routeGatewayTextSlashCommandIfSupported({
      agentId: "main",
      config: {
        gateway: {
          port: 18789,
          auth: {
            mode: "token",
            token: "gateway-token",
          },
        },
      },
      message: "/status",
      runId: "sms-status-1",
      sessionKey: "agent:main:sms:android-gateway",
    });

    expect(routed).toBe(true);
    expect(mocks.gatewayCtorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "ws://127.0.0.1:18789",
        token: "gateway-token",
        clientDisplayName: "sms-inbox-bridge",
      }),
    );
    expect(mocks.startMock).toHaveBeenCalledTimes(1);
    expect(mocks.requestMock).toHaveBeenNthCalledWith(1, "commands.list", {
      agentId: "main",
      scope: "text",
    });
    expect(mocks.requestMock).toHaveBeenNthCalledWith(2, "chat.send", {
      sessionKey: "agent:main:sms:android-gateway",
      message: "/status",
      idempotencyKey: "sms-status-1",
    });
    expect(mocks.stopAndWaitMock).toHaveBeenCalledTimes(1);
  });

  it("falls back when the slash-looking input does not map to a command", async () => {
    mocks.requestMock.mockResolvedValueOnce({
      commands: [{ textAliases: ["/status"], acceptsArgs: false }],
    });

    const routed = await routeGatewayTextSlashCommandIfSupported({
      agentId: "main",
      config: {
        gateway: {
          auth: {
            mode: "token",
            token: "gateway-token",
          },
        },
      },
      message: "/statusish",
      runId: "sms-statusish-1",
      sessionKey: "agent:main:sms:android-gateway",
    });

    expect(routed).toBe(false);
    expect(mocks.requestMock).toHaveBeenCalledTimes(1);
    expect(mocks.requestMock).toHaveBeenCalledWith("commands.list", {
      agentId: "main",
      scope: "text",
    });
  });

  it("resolves the loopback gateway connection from config", () => {
    expect(
      resolveGatewayLoopbackConnection({
        gateway: {
          port: 19000,
          auth: {
            mode: "password",
            password: "secret",
          },
        },
      }),
    ).toEqual({
      url: "ws://127.0.0.1:19000",
      password: "secret",
    });
  });
});

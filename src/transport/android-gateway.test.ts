import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AndroidGatewayTransport } from "./android-gateway.js";

function signWebhook(body: string, timestamp: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${body}${timestamp}`).digest("hex");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AndroidGatewayTransport.parseWebhook", () => {
  it("accepts a signed sms:received payload", () => {
    const transport = new AndroidGatewayTransport({
      config: {
        provider: "android-gateway",
        serverMode: "cloud",
        apiBaseUrl: "https://api.sms-gate.app/3rdparty/v1",
        username: "user",
        password: "pass",
        webhookPath: "/plugins/sms-inbox-bridge/webhook",
        webhookSigningKey: "secret",
        sendPriority: 100,
        deviceActiveWithinHours: 12,
        skipPhoneValidation: true,
      },
    });

    const body = JSON.stringify({
      deviceId: "device-1",
      event: "sms:received",
      id: "event-1",
      payload: {
        message: "hello from phone",
        sender: "+15551234567",
        recipient: "+15557654321",
        simNumber: 1,
        receivedAt: "2026-04-16T12:34:56.000Z",
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));

    const parsed = transport.parseWebhook({
      rawBody: body,
      headers: {
        "x-signature": signWebhook(body, timestamp, "secret"),
        "x-timestamp": timestamp,
      },
    });

    expect(parsed).toEqual({
      kind: "inbound-sms",
      event: {
        deviceId: "device-1",
        externalId: "event-1",
        from: "+15551234567",
        receivedAt: Date.parse("2026-04-16T12:34:56.000Z"),
        simNumber: 1,
        text: "hello from phone",
        to: "+15557654321",
      },
    });
  });

  it("rejects a bad signature", () => {
    const transport = new AndroidGatewayTransport({
      config: {
        provider: "android-gateway",
        serverMode: "cloud",
        apiBaseUrl: "https://api.sms-gate.app/3rdparty/v1",
        username: "user",
        password: "pass",
        webhookPath: "/plugins/sms-inbox-bridge/webhook",
        webhookSigningKey: "secret",
        sendPriority: 100,
        deviceActiveWithinHours: 12,
        skipPhoneValidation: true,
      },
    });

    const body = JSON.stringify({
      event: "sms:received",
      id: "event-1",
      payload: {
        message: "hello",
        sender: "+15551234567",
        receivedAt: "2026-04-16T12:34:56.000Z",
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));

    expect(() =>
      transport.parseWebhook({
        rawBody: body,
        headers: {
          "x-signature": "bad",
          "x-timestamp": timestamp,
        },
      }),
    ).toThrow("signature");
  });

  it("accepts an unsigned sms:received payload in local mode", () => {
    const transport = new AndroidGatewayTransport({
      config: {
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
    });

    const body = JSON.stringify({
      deviceId: "device-1",
      event: "sms:received",
      id: "event-1",
      payload: {
        message: "hello from phone",
        sender: "+15551234567",
        recipient: "+15557654321",
        simNumber: 1,
        receivedAt: "2026-04-16T12:34:56.000Z",
      },
    });

    const parsed = transport.parseWebhook({
      rawBody: body,
      headers: {},
    });

    expect(parsed).toEqual({
      kind: "inbound-sms",
      event: {
        deviceId: "device-1",
        externalId: "event-1",
        from: "+15551234567",
        receivedAt: Date.parse("2026-04-16T12:34:56.000Z"),
        simNumber: 1,
        text: "hello from phone",
        to: "+15557654321",
      },
    });
  });
});

describe("AndroidGatewayTransport.requestInboxExport", () => {
  it("requests an inbox export with the configured device id", async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 202, statusText: "Accepted" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new AndroidGatewayTransport({
      config: {
        provider: "android-gateway",
        serverMode: "local",
        apiBaseUrl: "http://127.0.0.1:18080",
        username: "sms",
        password: "pass",
        webhookPath: "/plugins/sms-inbox-bridge/webhook",
        deviceId: "device-1",
        sendPriority: 100,
        deviceActiveWithinHours: 12,
        skipPhoneValidation: true,
      },
    });

    await transport.requestInboxExport({
      since: Date.parse("2026-04-21T15:00:00.000Z"),
      until: Date.parse("2026-04-21T15:01:00.000Z"),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("http://127.0.0.1:18080/messages/inbox/export");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      authorization: `Basic ${Buffer.from("sms:pass", "utf8").toString("base64")}`,
      "content-type": "application/json",
      accept: "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      deviceId: "device-1",
      since: "2026-04-21T15:00:00.000Z",
      until: "2026-04-21T15:01:00.000Z",
    });
  });

  it("requires a configured device id", async () => {
    const transport = new AndroidGatewayTransport({
      config: {
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
    });

    await expect(
      transport.requestInboxExport({
        since: Date.parse("2026-04-21T15:00:00.000Z"),
        until: Date.parse("2026-04-21T15:01:00.000Z"),
      }),
    ).rejects.toThrow("deviceId");
  });
});

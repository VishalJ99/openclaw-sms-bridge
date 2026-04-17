import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { AndroidGatewayTransport } from "./android-gateway.js";

function signWebhook(body: string, timestamp: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${body}${timestamp}`).digest("hex");
}

describe("AndroidGatewayTransport.parseWebhook", () => {
  it("accepts a signed sms:received payload", () => {
    const transport = new AndroidGatewayTransport({
      config: {
        provider: "android-gateway",
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
});

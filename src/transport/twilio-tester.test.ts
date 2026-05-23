import { afterEach, describe, expect, it, vi } from "vitest";
import { TwilioTesterTransport } from "./twilio-tester.js";

const config = {
  accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  authToken: "auth-token",
  fromNumber: "+447360543151",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TwilioTesterTransport.parseWebhook", () => {
  it("accepts local JSON tester requests", () => {
    const transport = new TwilioTesterTransport({ config });

    const parsed = transport.parseWebhook({
      headers: {
        "content-type": "application/json",
      },
      rawBody: JSON.stringify({
        text: "hello from tester",
        id: "tester-1",
        receivedAt: "2026-05-04T12:00:00.000Z",
      }),
    });

    expect(parsed).toEqual({
      kind: "inbound-sms",
      event: {
        externalId: "tester-1",
        from: "+447360543151",
        receivedAt: Date.parse("2026-05-04T12:00:00.000Z"),
        text: "hello from tester",
        to: "+447360543151",
      },
    });
  });

  it("accepts Twilio form webhook shape", () => {
    const transport = new TwilioTesterTransport({ config });

    const parsed = transport.parseWebhook({
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      rawBody: new URLSearchParams({
        Body: "hi",
        From: "+447360543151",
        MessageSid: "SM123",
        To: "+447981839872",
      }).toString(),
    });

    expect(parsed).toEqual({
      kind: "inbound-sms",
      event: {
        externalId: "SM123",
        from: "+447360543151",
        receivedAt: expect.any(Number),
        text: "hi",
        to: "+447981839872",
      },
    });
  });
});

describe("TwilioTesterTransport.sendText", () => {
  it("sends messages through Twilio REST API", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ sid: "SM456" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new TwilioTesterTransport({ config });

    await expect(
      transport.sendText({
        text: "test message",
        to: "+447981839872",
      }),
    ).resolves.toEqual({
      accepted: true,
      providerMessageId: "SM456",
      raw: { sid: "SM456" },
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/Messages.json",
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      authorization: `Basic ${Buffer.from(
        "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx:auth-token",
        "utf8",
      ).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    });
    expect(String(init.body)).toBe(
      "Body=test+message&From=%2B447360543151&To=%2B447981839872",
    );
  });
});

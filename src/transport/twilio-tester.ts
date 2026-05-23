import crypto from "node:crypto";
import type {
  InboundSmsEvent,
  OutboundSms,
  OutboundSmsResult,
  ParsedSmsWebhook,
  RawWebhookRequest,
  SmsTransport,
} from "./types.js";

export type TwilioTesterTransportConfig = {
  accountSid: string;
  authToken: string;
  fromNumber: string;
};

export class TwilioTesterError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "TwilioTesterError";
  }
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function readHeader(request: RawWebhookRequest, name: string): string {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? (value[0] ?? "") : value ?? "";
}

function parseBody(request: RawWebhookRequest): URLSearchParams | Record<string, unknown> {
  const contentType = readHeader(request, "content-type").toLowerCase();
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(request.rawBody || "{}") as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new TwilioTesterError("Twilio tester JSON body must be an object", 400);
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof TwilioTesterError) {
        throw error;
      }
      throw new TwilioTesterError("Twilio tester JSON body is invalid", 400);
    }
  }
  return new URLSearchParams(request.rawBody);
}

function readField(
  body: URLSearchParams | Record<string, unknown>,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    if (body instanceof URLSearchParams) {
      const value = body.get(name);
      if (value?.trim()) {
        return value.trim();
      }
      continue;
    }
    const value = body[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readReceivedAt(value: string | undefined): number {
  if (!value) {
    return Date.now();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function createSyntheticId(text: string, from: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${from}\n${text}\n${Date.now()}`)
    .digest("hex")
    .slice(0, 16);
  return `twilio-tester-${digest}`;
}

export class TwilioTesterTransport implements SmsTransport {
  constructor(private readonly params: { config: TwilioTesterTransportConfig }) {}

  parseWebhook(request: RawWebhookRequest): ParsedSmsWebhook {
    const body = parseBody(request);
    const text = readField(body, "Body", "body", "text", "message");
    const from =
      readField(body, "From", "from", "sender") ?? this.params.config.fromNumber;
    if (!text) {
      throw new TwilioTesterError("Twilio tester request is missing Body/text", 400);
    }

    const externalId =
      readField(body, "MessageSid", "SmsSid", "messageSid", "id", "externalId") ??
      createSyntheticId(text, from);
    return {
      kind: "inbound-sms",
      event: {
        externalId,
        from,
        receivedAt: readReceivedAt(readField(body, "receivedAt", "DateCreated")),
        text,
        to: readField(body, "To", "to") ?? this.params.config.fromNumber,
      },
    };
  }

  async sendText(outbound: OutboundSms): Promise<OutboundSmsResult> {
    const endpoint = new URL(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
        this.params.config.accountSid,
      )}/Messages.json`,
    );
    const body = new URLSearchParams({
      Body: outbound.text,
      From: this.params.config.fromNumber,
      To: outbound.to,
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: basicAuth(
          this.params.config.accountSid,
          this.params.config.authToken,
        ),
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
    });
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    if (!response.ok) {
      throw new TwilioTesterError(
        `Twilio SMS send failed: HTTP ${response.status} ${text.slice(0, 200)}`,
        response.status,
      );
    }
    const providerMessageId =
      json && typeof json === "object" && "sid" in json && typeof json.sid === "string"
        ? json.sid
        : undefined;
    return {
      accepted: true,
      ...(providerMessageId ? { providerMessageId } : {}),
      raw: json,
    };
  }
}

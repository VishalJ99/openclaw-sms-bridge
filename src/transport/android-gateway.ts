import crypto from "node:crypto";
import type { ResolvedSmsBridgePluginConfig } from "../config.js";
import type {
  InboundSmsEvent,
  OutboundSms,
  OutboundSmsResult,
  ParsedSmsWebhook,
  RawWebhookRequest,
  SmsTransport,
} from "./types.js";

type AndroidGatewayTransportConfig = ResolvedSmsBridgePluginConfig["transport"];

type AndroidGatewayWebhookEnvelope = {
  deviceId?: string;
  event?: string;
  id?: string;
  payload?: Record<string, unknown>;
};

type AndroidGatewaySendResponse = {
  id?: unknown;
  messageId?: unknown;
};

export class SmsBridgeWebhookError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "SmsBridgeWebhookError";
  }
}

function ensureString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SmsBridgeWebhookError(`Missing webhook field: ${field}`, 400);
  }
  return value.trim();
}

function maybeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function maybeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseTimestamp(value: unknown, field: string): number {
  const parsed = Date.parse(ensureString(value, field));
  if (!Number.isFinite(parsed)) {
    throw new SmsBridgeWebhookError(`Invalid webhook timestamp: ${field}`, 400);
  }
  return parsed;
}

function verifyHmac(params: {
  rawBody: string;
  secret: string;
  signature: string;
  timestamp: string;
}): void {
  const expected = crypto
    .createHmac("sha256", params.secret)
    .update(`${params.rawBody}${params.timestamp}`)
    .digest("hex");
  const actual = params.signature.trim().toLowerCase();
  if (actual.length !== expected.length) {
    throw new SmsBridgeWebhookError("Webhook signature length mismatch", 401);
  }
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (actualBuffer.length !== expectedBuffer.length) {
    throw new SmsBridgeWebhookError("Webhook signature format mismatch", 401);
  }
  if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new SmsBridgeWebhookError("Webhook signature mismatch", 401);
  }
}

function validateTimestamp(timestamp: string): void {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) {
    throw new SmsBridgeWebhookError("Missing webhook timestamp", 401);
  }
  const driftSeconds = Math.abs(Math.floor(Date.now() / 1000) - Math.floor(seconds));
  if (driftSeconds > 5 * 60) {
    throw new SmsBridgeWebhookError("Webhook timestamp outside allowed skew", 401);
  }
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined;
  }
  return await response.json();
}

function resolveProviderMessageId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const payload = value as AndroidGatewaySendResponse;
  if (typeof payload.id === "string" && payload.id.trim().length > 0) {
    return payload.id.trim();
  }
  if (typeof payload.messageId === "string" && payload.messageId.trim().length > 0) {
    return payload.messageId.trim();
  }
  return undefined;
}

export class AndroidGatewayTransport implements SmsTransport {
  constructor(private readonly params: { config: AndroidGatewayTransportConfig }) {}

  parseWebhook(request: RawWebhookRequest): ParsedSmsWebhook {
    const signature = request.headers["x-signature"];
    const timestamp = request.headers["x-timestamp"];
    if (typeof signature !== "string" || typeof timestamp !== "string") {
      throw new SmsBridgeWebhookError("Missing webhook signature headers", 401);
    }
    validateTimestamp(timestamp);
    verifyHmac({
      rawBody: request.rawBody,
      secret: this.params.config.webhookSigningKey,
      signature,
      timestamp,
    });

    let envelope: AndroidGatewayWebhookEnvelope;
    try {
      envelope = JSON.parse(request.rawBody) as AndroidGatewayWebhookEnvelope;
    } catch {
      throw new SmsBridgeWebhookError("Webhook body is not valid JSON", 400);
    }

    const event = maybeString(envelope.event);
    if (!event) {
      throw new SmsBridgeWebhookError("Webhook event is missing", 400);
    }
    if (event !== "sms:received") {
      return { kind: "ignore" };
    }

    const payload = envelope.payload ?? {};
    const inbound: InboundSmsEvent = {
      externalId: ensureString(envelope.id, "id"),
      text: ensureString(payload.message, "payload.message"),
      from: ensureString(payload.sender, "payload.sender"),
      receivedAt: parseTimestamp(payload.receivedAt, "payload.receivedAt"),
      ...(maybeString(payload.recipient) ? { to: maybeString(payload.recipient) } : {}),
      ...(maybeNumber(payload.simNumber) ? { simNumber: maybeNumber(payload.simNumber) } : {}),
      ...(maybeString(envelope.deviceId) ? { deviceId: maybeString(envelope.deviceId) } : {}),
    };

    return {
      kind: "inbound-sms",
      event: inbound,
    };
  }

  async sendText(outbound: OutboundSms): Promise<OutboundSmsResult> {
    const query = new URLSearchParams();
    if (this.params.config.skipPhoneValidation) {
      query.set("skipPhoneValidation", "true");
    }
    if (this.params.config.deviceActiveWithinHours > 0) {
      query.set(
        "deviceActiveWithin",
        String(this.params.config.deviceActiveWithinHours),
      );
    }

    const url = new URL(`${this.params.config.apiBaseUrl.replace(/\/$/, "")}/messages`);
    if (query.size > 0) {
      url.search = query.toString();
    }

    const body: Record<string, unknown> = {
      textMessage: {
        text: outbound.text,
      },
      phoneNumbers: [outbound.to],
      priority: this.params.config.sendPriority,
      ...(outbound.idempotencyKey ? { id: outbound.idempotencyKey } : {}),
      ...(this.params.config.deviceId ? { deviceId: this.params.config.deviceId } : {}),
      ...(typeof this.params.config.simNumber === "number"
        ? { simNumber: this.params.config.simNumber }
        : {}),
      ...(typeof this.params.config.ttlSeconds === "number"
        ? { ttl: this.params.config.ttlSeconds }
        : {}),
    };

    const auth = Buffer.from(
      `${this.params.config.username}:${this.params.config.password}`,
      "utf8",
    ).toString("base64");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    const raw = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(
        `Android gateway send failed: ${response.status} ${response.statusText}`,
      );
    }

    return {
      accepted: true,
      providerMessageId: resolveProviderMessageId(raw) ?? outbound.idempotencyKey,
      raw,
    };
  }
}

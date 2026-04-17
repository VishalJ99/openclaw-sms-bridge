import type { IncomingHttpHeaders } from "node:http";

export type InboundSmsEvent = {
  deviceId?: string;
  externalId: string;
  from: string;
  receivedAt: number;
  simNumber?: number;
  text: string;
  to?: string;
};

export type OutboundSms = {
  idempotencyKey?: string;
  text: string;
  to: string;
};

export type OutboundSmsResult = {
  accepted: boolean;
  providerMessageId?: string;
  raw?: unknown;
};

export type RawWebhookRequest = {
  headers: IncomingHttpHeaders;
  rawBody: string;
};

export type ParsedSmsWebhook =
  | { kind: "ignore" }
  | { kind: "inbound-sms"; event: InboundSmsEvent };

export type SmsTransport = {
  parseWebhook: (request: RawWebhookRequest) => ParsedSmsWebhook;
  sendText: (outbound: OutboundSms) => Promise<OutboundSmsResult>;
};

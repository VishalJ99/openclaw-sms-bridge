import crypto from "node:crypto";
import type { AnyAgentTool, PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { ResolvedSmsBridgePluginConfig } from "./config.js";
import type { SmsTransport } from "./transport/types.js";

type HumanAlertParams = {
  action?: unknown;
  message?: unknown;
  reason?: unknown;
};

type ParsedHumanAlertParams = {
  action: string;
  message: string;
  reason: string;
};

type HumanAlertDetails =
  | {
      action: "sms";
      status: "sent";
      providerMessageId?: string;
    }
  | {
      action: "call_alert";
      status: "requested" | "dry-run" | "blocked";
      reason: string;
      blockedBy?: "disabled" | "cooldown" | "daily-limit";
      retryAfterSeconds?: number;
    };

type CreateHumanAlertToolParams = {
  logger: PluginLogger;
  pluginConfig: ResolvedSmsBridgePluginConfig;
  transport: Pick<SmsTransport, "sendText">;
  now?: () => number;
  fetchImpl?: typeof fetch;
};

function toolResult(details: HumanAlertDetails) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
    details,
  };
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} required`);
  }
  return value.trim();
}

function readHumanAlertParams(params: unknown): ParsedHumanAlertParams {
  const record =
    params && typeof params === "object" && !Array.isArray(params)
      ? (params as HumanAlertParams)
      : {};
  return {
    action: readNonEmptyString(record.action, "action"),
    message: typeof record.message === "string" ? record.message.trim() : "",
    reason: readNonEmptyString(record.reason, "reason"),
  };
}

function pruneOldCallAttempts(attempts: number[], now: number): number[] {
  const windowStart = now - 24 * 60 * 60 * 1000;
  return attempts.filter((timestamp) => timestamp >= windowStart);
}

async function parseHelperResponse(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {};
  }
  const parsed = await response.json();
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

export function createHumanAlertTool(params: CreateHumanAlertToolParams): AnyAgentTool {
  const now = params.now ?? (() => Date.now());
  const fetchImpl = params.fetchImpl ?? fetch;
  let lastCallAlertAt = 0;
  let callAlertAttempts: number[] = [];

  return {
    name: "human_alert",
    label: "Human Alert",
    displaySummary: "Send a guarded SMS or call-alert escalation to the configured bound human.",
    description:
      "Alert the configured bound human over SMS or a call-alert ring. This tool never accepts arbitrary recipient numbers.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["action", "reason"],
      properties: {
        action: {
          type: "string",
          enum: ["sms", "call_alert"],
          description: "Use sms for normal async reachability; use call_alert only for urgent escalation.",
        },
        message: {
          type: "string",
          description: "SMS body. Ignored for call_alert.",
        },
        reason: {
          type: "string",
          description: "Short audit reason for why the human is being alerted.",
        },
      },
    },
    async execute(_toolCallId, rawParams) {
      if (!params.pluginConfig.alert.enabled) {
        throw new Error("human_alert is disabled by sms-inbox-bridge config");
      }

      const input = readHumanAlertParams(rawParams);
      if (input.action === "sms") {
        if (!params.pluginConfig.alert.sms.enabled) {
          throw new Error("human_alert SMS is disabled by sms-inbox-bridge config");
        }
        const message = readNonEmptyString(input.message, "message");
        if (message.length > params.pluginConfig.alert.sms.maxChars) {
          throw new Error(
            `message exceeds alert.sms.maxChars (${params.pluginConfig.alert.sms.maxChars})`,
          );
        }
        const result = await params.transport.sendText({
          idempotencyKey: `human-alert-${crypto.randomUUID()}`,
          text: message,
          to: params.pluginConfig.binding.phoneNumber,
        });
        params.logger.info?.(
          `sms-inbox-bridge human_alert SMS sent reason=${JSON.stringify(input.reason)}`,
        );
        return toolResult({
          action: "sms",
          status: "sent",
          ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
        });
      }

      if (input.action !== "call_alert") {
        throw new Error("action must be sms or call_alert");
      }

      const call = params.pluginConfig.alert.call;
      if (!call.enabled || call.mode === "disabled") {
        return toolResult({
          action: "call_alert",
          status: "blocked",
          reason: input.reason,
          blockedBy: "disabled",
        });
      }

      const currentTime = now();
      callAlertAttempts = pruneOldCallAttempts(callAlertAttempts, currentTime);
      if (call.maxPerDay === 0 || callAlertAttempts.length >= call.maxPerDay) {
        return toolResult({
          action: "call_alert",
          status: "blocked",
          reason: input.reason,
          blockedBy: "daily-limit",
        });
      }
      const elapsedSeconds = Math.floor((currentTime - lastCallAlertAt) / 1000);
      if (lastCallAlertAt > 0 && elapsedSeconds < call.cooldownSeconds) {
        return toolResult({
          action: "call_alert",
          status: "blocked",
          reason: input.reason,
          blockedBy: "cooldown",
          retryAfterSeconds: call.cooldownSeconds - elapsedSeconds,
        });
      }

      if (call.mode === "dry-run") {
        lastCallAlertAt = currentTime;
        callAlertAttempts.push(currentTime);
        params.logger.info?.(
          `sms-inbox-bridge human_alert call dry-run reason=${JSON.stringify(input.reason)}`,
        );
        return toolResult({
          action: "call_alert",
          status: "dry-run",
          reason: input.reason,
        });
      }

      const response = await fetchImpl(call.endpointUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(call.bearerToken ? { authorization: `Bearer ${call.bearerToken}` } : {}),
        },
        body: JSON.stringify({
          reason: input.reason,
          requestedAt: new Date(currentTime).toISOString(),
        }),
      });
      const helperPayload = await parseHelperResponse(response);
      if (
        response.status === 429 &&
        helperPayload.status === "blocked" &&
        (helperPayload.blockedBy === "cooldown" || helperPayload.blockedBy === "daily-limit")
      ) {
        return toolResult({
          action: "call_alert",
          status: "blocked",
          reason: input.reason,
          blockedBy: helperPayload.blockedBy,
          ...(typeof helperPayload.retryAfterSeconds === "number"
            ? { retryAfterSeconds: helperPayload.retryAfterSeconds }
            : {}),
        });
      }
      if (!response.ok) {
        throw new Error(`call alert helper failed: ${response.status} ${response.statusText}`);
      }

      lastCallAlertAt = currentTime;
      callAlertAttempts.push(currentTime);
      params.logger.warn?.(
        `sms-inbox-bridge human_alert call requested reason=${JSON.stringify(input.reason)}`,
      );
      return toolResult({
        action: "call_alert",
        status: helperPayload.status === "dry-run" ? "dry-run" : "requested",
        reason: input.reason,
      });
    },
  };
}

import { buildPluginConfigSchema, type OpenClawPluginConfigSchema } from "openclaw/plugin-sdk/core";
import { z } from "openclaw/plugin-sdk/zod";

export type SmsBridgePluginConfig = {
  binding?: {
    sessionKey?: string;
    phoneNumber?: string;
  };
  transport?: {
    provider?: "android-gateway";
    apiBaseUrl?: string;
    username?: string;
    password?: string;
    webhookPath?: string;
    webhookSigningKey?: string;
    deviceId?: string;
    simNumber?: number;
    sendPriority?: number;
    ttlSeconds?: number;
    deviceActiveWithinHours?: number;
    skipPhoneValidation?: boolean;
  };
  outbound?: {
    maxSegmentChars?: number;
    maxSegmentsPerReply?: number;
  };
};

export type ResolvedSmsBridgePluginConfig = {
  binding: {
    sessionKey: string;
    phoneNumber: string;
  };
  transport: {
    provider: "android-gateway";
    apiBaseUrl: string;
    username: string;
    password: string;
    webhookPath: string;
    webhookSigningKey: string;
    deviceId?: string;
    simNumber?: number;
    sendPriority: number;
    ttlSeconds?: number;
    deviceActiveWithinHours: number;
    skipPhoneValidation: boolean;
  };
  outbound: {
    maxSegmentChars: number;
    maxSegmentsPerReply: number;
  };
};

const DEFAULT_SESSION_KEY = "agent:main:main";
const DEFAULT_API_BASE_URL = "https://api.sms-gate.app/3rdparty/v1";
const DEFAULT_WEBHOOK_PATH = "/plugins/sms-inbox-bridge/webhook";
const DEFAULT_MAX_SEGMENT_CHARS = 300;
const DEFAULT_MAX_SEGMENTS_PER_REPLY = 6;
const DEFAULT_SEND_PRIORITY = 100;
const DEFAULT_DEVICE_ACTIVE_WITHIN_HOURS = 12;

const nonEmptyTrimmedString = (message: string) =>
  z.string({ error: message }).trim().min(1, { error: message });

const SmsBridgePluginConfigSchemaSource = z.strictObject({
  binding: z
    .strictObject({
      sessionKey: nonEmptyTrimmedString("binding.sessionKey must be a non-empty string").optional(),
      phoneNumber: nonEmptyTrimmedString("binding.phoneNumber must be a non-empty string").optional(),
    })
    .optional(),
  transport: z
    .strictObject({
      provider: z.literal("android-gateway").optional(),
      apiBaseUrl: nonEmptyTrimmedString(
        "transport.apiBaseUrl must be a non-empty string",
      ).optional(),
      username: nonEmptyTrimmedString("transport.username must be a non-empty string").optional(),
      password: nonEmptyTrimmedString("transport.password must be a non-empty string").optional(),
      webhookPath: nonEmptyTrimmedString(
        "transport.webhookPath must be a non-empty string",
      ).optional(),
      webhookSigningKey: nonEmptyTrimmedString(
        "transport.webhookSigningKey must be a non-empty string",
      ).optional(),
      deviceId: nonEmptyTrimmedString("transport.deviceId must be a non-empty string").optional(),
      simNumber: z
        .number({ error: "transport.simNumber must be a number between 1 and 3" })
        .int({ error: "transport.simNumber must be a number between 1 and 3" })
        .min(1, { error: "transport.simNumber must be a number between 1 and 3" })
        .max(3, { error: "transport.simNumber must be a number between 1 and 3" })
        .optional(),
      sendPriority: z
        .number({ error: "transport.sendPriority must be a number between -128 and 127" })
        .int({ error: "transport.sendPriority must be a number between -128 and 127" })
        .min(-128, { error: "transport.sendPriority must be a number between -128 and 127" })
        .max(127, { error: "transport.sendPriority must be a number between -128 and 127" })
        .optional(),
      ttlSeconds: z
        .number({ error: "transport.ttlSeconds must be a number >= 1" })
        .int({ error: "transport.ttlSeconds must be a number >= 1" })
        .min(1, { error: "transport.ttlSeconds must be a number >= 1" })
        .optional(),
      deviceActiveWithinHours: z
        .number({ error: "transport.deviceActiveWithinHours must be a number >= 0" })
        .int({ error: "transport.deviceActiveWithinHours must be a number >= 0" })
        .min(0, { error: "transport.deviceActiveWithinHours must be a number >= 0" })
        .optional(),
      skipPhoneValidation: z.boolean({ error: "transport.skipPhoneValidation must be a boolean" }).optional(),
    })
    .optional(),
  outbound: z
    .strictObject({
      maxSegmentChars: z
        .number({ error: "outbound.maxSegmentChars must be a number between 60 and 1000" })
        .int({ error: "outbound.maxSegmentChars must be a number between 60 and 1000" })
        .min(60, { error: "outbound.maxSegmentChars must be a number between 60 and 1000" })
        .max(1000, { error: "outbound.maxSegmentChars must be a number between 60 and 1000" })
        .optional(),
      maxSegmentsPerReply: z
        .number({ error: "outbound.maxSegmentsPerReply must be a number between 1 and 20" })
        .int({ error: "outbound.maxSegmentsPerReply must be a number between 1 and 20" })
        .min(1, { error: "outbound.maxSegmentsPerReply must be a number between 1 and 20" })
        .max(20, { error: "outbound.maxSegmentsPerReply must be a number between 1 and 20" })
        .optional(),
    })
    .optional(),
});

function formatConfigIssue(issue: z.ZodIssue | undefined): string {
  if (!issue) {
    return "invalid config";
  }
  if (issue.code === "unrecognized_keys" && issue.keys.length > 0) {
    return `unknown config key: ${issue.keys[0]}`;
  }
  if (issue.code === "invalid_type" && issue.path.length === 0) {
    return "expected config object";
  }
  return issue.message;
}

function normalizeWebhookPath(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_WEBHOOK_PATH;
  return candidate.startsWith("/") ? candidate : `/${candidate}`;
}

export function normalizePhoneNumber(value: string): string {
  const trimmed = value.trim();
  const normalized = trimmed.replace(/[^\d+]/g, "");
  if (!normalized) {
    throw new Error("binding.phoneNumber must contain digits");
  }
  return normalized.startsWith("+")
    ? `+${normalized.slice(1).replace(/[+]/g, "")}`
    : normalized.replace(/[+]/g, "");
}

function requireField<T>(value: T | undefined, path: string): T {
  if (value === undefined) {
    throw new Error(`Missing required config: ${path}`);
  }
  return value;
}

export function createSmsBridgePluginConfigSchema(): OpenClawPluginConfigSchema {
  return buildPluginConfigSchema(SmsBridgePluginConfigSchemaSource, {
    safeParse(value) {
      if (value === undefined) {
        return { success: true, data: undefined };
      }
      const parsed = SmsBridgePluginConfigSchemaSource.safeParse(value);
      if (parsed.success) {
        return { success: true, data: parsed.data };
      }
      return {
        success: false,
        error: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.filter(
              (segment): segment is string | number =>
                typeof segment === "string" || typeof segment === "number",
            ),
            message: formatConfigIssue(issue),
          })),
        },
      };
    },
  });
}

export function resolveSmsBridgePluginConfig(
  value: unknown,
): ResolvedSmsBridgePluginConfig {
  if (value === undefined) {
    throw new Error(
      "Missing sms-inbox-bridge config. Configure plugins.entries.sms-inbox-bridge.config first.",
    );
  }

  const parsed = SmsBridgePluginConfigSchemaSource.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid sms-inbox-bridge config: ${formatConfigIssue(parsed.error.issues[0])}`);
  }

  const cfg = parsed.data as SmsBridgePluginConfig;
  const binding = cfg.binding ?? {};
  const transport = cfg.transport ?? {};
  const outbound = cfg.outbound ?? {};

  const provider = transport.provider ?? "android-gateway";
  if (provider !== "android-gateway") {
    throw new Error(`Unsupported sms-inbox-bridge transport provider: ${provider}`);
  }

  return {
    binding: {
      sessionKey: binding.sessionKey ?? DEFAULT_SESSION_KEY,
      phoneNumber: normalizePhoneNumber(
        requireField(binding.phoneNumber, "binding.phoneNumber"),
      ),
    },
    transport: {
      provider,
      apiBaseUrl: transport.apiBaseUrl ?? DEFAULT_API_BASE_URL,
      username: requireField(transport.username, "transport.username"),
      password: requireField(transport.password, "transport.password"),
      webhookPath: normalizeWebhookPath(transport.webhookPath),
      webhookSigningKey: requireField(
        transport.webhookSigningKey,
        "transport.webhookSigningKey",
      ),
      ...(transport.deviceId ? { deviceId: transport.deviceId } : {}),
      ...(typeof transport.simNumber === "number" ? { simNumber: transport.simNumber } : {}),
      sendPriority: transport.sendPriority ?? DEFAULT_SEND_PRIORITY,
      ...(typeof transport.ttlSeconds === "number" ? { ttlSeconds: transport.ttlSeconds } : {}),
      deviceActiveWithinHours:
        transport.deviceActiveWithinHours ?? DEFAULT_DEVICE_ACTIVE_WITHIN_HOURS,
      skipPhoneValidation: transport.skipPhoneValidation ?? true,
    },
    outbound: {
      maxSegmentChars: outbound.maxSegmentChars ?? DEFAULT_MAX_SEGMENT_CHARS,
      maxSegmentsPerReply: outbound.maxSegmentsPerReply ?? DEFAULT_MAX_SEGMENTS_PER_REPLY,
    },
  };
}

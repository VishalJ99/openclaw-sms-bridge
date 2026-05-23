import { buildPluginConfigSchema, type OpenClawPluginConfigSchema } from "openclaw/plugin-sdk/core";
import { z } from "openclaw/plugin-sdk/zod";

export type SmsBridgePluginConfig = {
  binding?: {
    sessionKey?: string;
    phoneNumber?: string;
  };
  transport?: {
    provider?: "android-gateway";
    serverMode?: "cloud" | "local";
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
  inboundRecovery?: {
    enabled?: boolean;
    catchUpOnStart?: boolean;
    pollIntervalMs?: number;
    lookbackMinutes?: number;
    safetyLagMs?: number;
  };
  alert?: {
    enabled?: boolean;
    sms?: {
      enabled?: boolean;
      maxChars?: number;
    };
    call?: {
      enabled?: boolean;
      mode?: "disabled" | "dry-run" | "local-http";
      endpointUrl?: string;
      bearerToken?: string;
      ringSeconds?: number;
    };
  };
  outbound?: {
    maxSegmentChars?: number;
    maxSegmentsPerReply?: number;
  };
  tester?: {
    enabled?: boolean;
    routePath?: string;
    sessionKey?: string;
    phoneNumber?: string;
    sharedSecret?: string;
    twilio?: {
      accountSid?: string;
      authToken?: string;
      fromNumber?: string;
    };
  };
};

export type ResolvedSmsBridgePluginConfig = {
  binding: {
    sessionKey: string;
    phoneNumber: string;
  };
  transport: {
    provider: "android-gateway";
    serverMode: "cloud" | "local";
    apiBaseUrl: string;
    username: string;
    password: string;
    webhookPath: string;
    webhookSigningKey?: string;
    deviceId?: string;
    simNumber?: number;
    sendPriority: number;
    ttlSeconds?: number;
    deviceActiveWithinHours: number;
    skipPhoneValidation: boolean;
  };
  inboundRecovery: {
    enabled: boolean;
    catchUpOnStart: boolean;
    pollIntervalMs: number;
    lookbackMinutes: number;
    safetyLagMs: number;
  };
  alert: {
    enabled: boolean;
    sms: {
      enabled: boolean;
      maxChars: number;
    };
    call: {
      enabled: boolean;
      mode: "disabled" | "dry-run" | "local-http";
      endpointUrl: string;
      bearerToken?: string;
      ringSeconds: number;
    };
  };
  outbound: {
    maxSegmentChars: number;
    maxSegmentsPerReply: number;
  };
  tester:
    | {
        enabled: false;
        routePath: string;
        sessionKey: string;
        phoneNumber?: string;
        sharedSecret?: string;
        twilio?: {
          accountSid?: string;
          authToken?: string;
          fromNumber?: string;
        };
      }
    | {
        enabled: true;
        routePath: string;
        sessionKey: string;
        phoneNumber: string;
        sharedSecret: string;
        twilio: {
          accountSid: string;
          authToken: string;
          fromNumber: string;
        };
      };
};

const DEFAULT_SESSION_KEY = "agent:main:main";
const DEFAULT_SERVER_MODE = "cloud";
const DEFAULT_API_BASE_URL = "https://api.sms-gate.app/3rdparty/v1";
const DEFAULT_WEBHOOK_PATH = "/plugins/sms-inbox-bridge/webhook";
const DEFAULT_MAX_SEGMENT_CHARS = 300;
const DEFAULT_MAX_SEGMENTS_PER_REPLY = 6;
const DEFAULT_SEND_PRIORITY = 100;
const DEFAULT_DEVICE_ACTIVE_WITHIN_HOURS = 12;
const DEFAULT_INBOUND_RECOVERY_POLL_INTERVAL_MS = 30_000;
const DEFAULT_INBOUND_RECOVERY_LOOKBACK_MINUTES = 60;
const DEFAULT_INBOUND_RECOVERY_SAFETY_LAG_MS = 5_000;
const DEFAULT_ALERT_SMS_MAX_CHARS = 300;
const DEFAULT_CALL_ALERT_ENDPOINT_URL = "http://127.0.0.1:18790/call-alert";
const DEFAULT_CALL_ALERT_RING_SECONDS = 8;
const DEFAULT_TESTER_ROUTE_PATH = "/plugins/sms-inbox-bridge/tester/twilio";
const DEFAULT_TESTER_SESSION_SUFFIX = "sms:twilio-tester";

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
      serverMode: z.enum(["cloud", "local"]).optional(),
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
  inboundRecovery: z
    .strictObject({
      enabled: z.boolean({ error: "inboundRecovery.enabled must be a boolean" }).optional(),
      catchUpOnStart: z.boolean({ error: "inboundRecovery.catchUpOnStart must be a boolean" }).optional(),
      pollIntervalMs: z
        .number({ error: "inboundRecovery.pollIntervalMs must be a number between 5000 and 3600000" })
        .int({ error: "inboundRecovery.pollIntervalMs must be a number between 5000 and 3600000" })
        .min(5_000, { error: "inboundRecovery.pollIntervalMs must be a number between 5000 and 3600000" })
        .max(3_600_000, { error: "inboundRecovery.pollIntervalMs must be a number between 5000 and 3600000" })
        .optional(),
      lookbackMinutes: z
        .number({ error: "inboundRecovery.lookbackMinutes must be a number between 1 and 1440" })
        .int({ error: "inboundRecovery.lookbackMinutes must be a number between 1 and 1440" })
        .min(1, { error: "inboundRecovery.lookbackMinutes must be a number between 1 and 1440" })
        .max(1_440, { error: "inboundRecovery.lookbackMinutes must be a number between 1 and 1440" })
        .optional(),
      safetyLagMs: z
        .number({ error: "inboundRecovery.safetyLagMs must be a number between 0 and 60000" })
        .int({ error: "inboundRecovery.safetyLagMs must be a number between 0 and 60000" })
        .min(0, { error: "inboundRecovery.safetyLagMs must be a number between 0 and 60000" })
        .max(60_000, { error: "inboundRecovery.safetyLagMs must be a number between 0 and 60000" })
        .optional(),
    })
    .optional(),
  alert: z
    .strictObject({
      enabled: z.boolean({ error: "alert.enabled must be a boolean" }).optional(),
      sms: z
        .strictObject({
          enabled: z.boolean({ error: "alert.sms.enabled must be a boolean" }).optional(),
          maxChars: z
            .number({ error: "alert.sms.maxChars must be a number between 1 and 1000" })
            .int({ error: "alert.sms.maxChars must be a number between 1 and 1000" })
            .min(1, { error: "alert.sms.maxChars must be a number between 1 and 1000" })
            .max(1000, { error: "alert.sms.maxChars must be a number between 1 and 1000" })
            .optional(),
        })
        .optional(),
      call: z
        .strictObject({
          enabled: z.boolean({ error: "alert.call.enabled must be a boolean" }).optional(),
          mode: z.enum(["disabled", "dry-run", "local-http"]).optional(),
          endpointUrl: nonEmptyTrimmedString(
            "alert.call.endpointUrl must be a non-empty string",
          ).optional(),
          bearerToken: nonEmptyTrimmedString(
            "alert.call.bearerToken must be a non-empty string",
          ).optional(),
          ringSeconds: z
            .number({ error: "alert.call.ringSeconds must be a number between 1 and 60" })
            .int({ error: "alert.call.ringSeconds must be a number between 1 and 60" })
            .min(1, { error: "alert.call.ringSeconds must be a number between 1 and 60" })
            .max(60, { error: "alert.call.ringSeconds must be a number between 1 and 60" })
            .optional(),
        })
        .optional(),
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
  tester: z
    .strictObject({
      enabled: z.boolean({ error: "tester.enabled must be a boolean" }).optional(),
      routePath: nonEmptyTrimmedString("tester.routePath must be a non-empty string").optional(),
      sessionKey: nonEmptyTrimmedString("tester.sessionKey must be a non-empty string").optional(),
      phoneNumber: nonEmptyTrimmedString("tester.phoneNumber must be a non-empty string").optional(),
      sharedSecret: nonEmptyTrimmedString("tester.sharedSecret must be a non-empty string").optional(),
      twilio: z
        .strictObject({
          accountSid: nonEmptyTrimmedString(
            "tester.twilio.accountSid must be a non-empty string",
          ).optional(),
          authToken: nonEmptyTrimmedString(
            "tester.twilio.authToken must be a non-empty string",
          ).optional(),
          fromNumber: nonEmptyTrimmedString(
            "tester.twilio.fromNumber must be a non-empty string",
          ).optional(),
        })
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

function normalizeRoutePath(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  return candidate.startsWith("/") ? candidate : `/${candidate}`;
}

function deriveTesterSessionKey(sessionKey: string): string {
  const match = /^agent:([^:]+):/i.exec(sessionKey.trim());
  if (!match?.[1]) {
    return `agent:main:${DEFAULT_TESTER_SESSION_SUFFIX}`;
  }
  return `agent:${match[1]}:${DEFAULT_TESTER_SESSION_SUFFIX}`;
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
  const inboundRecovery = cfg.inboundRecovery ?? {};
  const alert = cfg.alert ?? {};
  const alertSms = alert.sms ?? {};
  const alertCall = alert.call ?? {};
  const outbound = cfg.outbound ?? {};
  const tester = cfg.tester ?? {};
  const testerTwilio = tester.twilio ?? {};

  const provider = transport.provider ?? "android-gateway";
  if (provider !== "android-gateway") {
    throw new Error(`Unsupported sms-inbox-bridge transport provider: ${provider}`);
  }
  const serverMode = transport.serverMode ?? DEFAULT_SERVER_MODE;

  const bindingSessionKey = binding.sessionKey ?? DEFAULT_SESSION_KEY;
  const resolvedTesterRoutePath = normalizeRoutePath(
    tester.routePath,
    DEFAULT_TESTER_ROUTE_PATH,
  );
  const resolvedTesterSessionKey =
    tester.sessionKey ?? deriveTesterSessionKey(bindingSessionKey);
  const resolvedTester = tester.enabled
    ? {
        enabled: true as const,
        routePath: resolvedTesterRoutePath,
        sessionKey: resolvedTesterSessionKey,
        phoneNumber: normalizePhoneNumber(
          requireField(tester.phoneNumber, "tester.phoneNumber"),
        ),
        sharedSecret: requireField(tester.sharedSecret, "tester.sharedSecret"),
        twilio: {
          accountSid: requireField(testerTwilio.accountSid, "tester.twilio.accountSid"),
          authToken: requireField(testerTwilio.authToken, "tester.twilio.authToken"),
          fromNumber: normalizePhoneNumber(
            requireField(testerTwilio.fromNumber, "tester.twilio.fromNumber"),
          ),
        },
      }
    : {
        enabled: false as const,
        routePath: resolvedTesterRoutePath,
        sessionKey: resolvedTesterSessionKey,
        ...(tester.phoneNumber
          ? { phoneNumber: normalizePhoneNumber(tester.phoneNumber) }
          : {}),
        ...(tester.sharedSecret ? { sharedSecret: tester.sharedSecret } : {}),
        ...(tester.twilio
          ? {
              twilio: {
                ...(testerTwilio.accountSid ? { accountSid: testerTwilio.accountSid } : {}),
                ...(testerTwilio.authToken ? { authToken: testerTwilio.authToken } : {}),
                ...(testerTwilio.fromNumber
                  ? { fromNumber: normalizePhoneNumber(testerTwilio.fromNumber) }
                  : {}),
              },
            }
          : {}),
      };

  return {
    binding: {
      sessionKey: bindingSessionKey,
      phoneNumber: normalizePhoneNumber(
        requireField(binding.phoneNumber, "binding.phoneNumber"),
      ),
    },
    transport: {
      provider,
      serverMode,
      apiBaseUrl: transport.apiBaseUrl ?? DEFAULT_API_BASE_URL,
      username: requireField(transport.username, "transport.username"),
      password: requireField(transport.password, "transport.password"),
      webhookPath: normalizeWebhookPath(transport.webhookPath),
      ...(serverMode === "cloud"
        ? {
            webhookSigningKey: requireField(
              transport.webhookSigningKey,
              "transport.webhookSigningKey",
            ),
          }
        : transport.webhookSigningKey
          ? { webhookSigningKey: transport.webhookSigningKey }
          : {}),
      ...(transport.deviceId ? { deviceId: transport.deviceId } : {}),
      ...(typeof transport.simNumber === "number" ? { simNumber: transport.simNumber } : {}),
      sendPriority: transport.sendPriority ?? DEFAULT_SEND_PRIORITY,
      ...(typeof transport.ttlSeconds === "number" ? { ttlSeconds: transport.ttlSeconds } : {}),
      deviceActiveWithinHours:
        transport.deviceActiveWithinHours ?? DEFAULT_DEVICE_ACTIVE_WITHIN_HOURS,
      skipPhoneValidation: transport.skipPhoneValidation ?? true,
    },
    inboundRecovery: {
      enabled: inboundRecovery.enabled ?? false,
      catchUpOnStart: inboundRecovery.catchUpOnStart ?? false,
      pollIntervalMs:
        inboundRecovery.pollIntervalMs ?? DEFAULT_INBOUND_RECOVERY_POLL_INTERVAL_MS,
      lookbackMinutes:
        inboundRecovery.lookbackMinutes ?? DEFAULT_INBOUND_RECOVERY_LOOKBACK_MINUTES,
      safetyLagMs:
        inboundRecovery.safetyLagMs ?? DEFAULT_INBOUND_RECOVERY_SAFETY_LAG_MS,
    },
    alert: {
      enabled: alert.enabled ?? false,
      sms: {
        enabled: alertSms.enabled ?? true,
        maxChars: alertSms.maxChars ?? DEFAULT_ALERT_SMS_MAX_CHARS,
      },
      call: {
        enabled: alertCall.enabled ?? false,
        mode: alertCall.mode ?? "disabled",
        endpointUrl: alertCall.endpointUrl ?? DEFAULT_CALL_ALERT_ENDPOINT_URL,
        ...(alertCall.bearerToken ? { bearerToken: alertCall.bearerToken } : {}),
        ringSeconds: alertCall.ringSeconds ?? DEFAULT_CALL_ALERT_RING_SECONDS,
      },
    },
    outbound: {
      maxSegmentChars: outbound.maxSegmentChars ?? DEFAULT_MAX_SEGMENT_CHARS,
      maxSegmentsPerReply: outbound.maxSegmentsPerReply ?? DEFAULT_MAX_SEGMENTS_PER_REPLY,
    },
    tester: resolvedTester,
  };
}

import { buffer } from "node:stream/consumers";
import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi, OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import { isAuthorizedPhoneNumber, resolveBoundSessionState } from "./binding.js";
import { createHumanAlertTool } from "./alert.js";
import type { ResolvedSmsBridgePluginConfig } from "./config.js";
import { SmsInboundHandler } from "./inbound.js";
import { SmsOutboundMirror } from "./outbound.js";
import { AndroidGatewayTransport, SmsBridgeWebhookError } from "./transport/android-gateway.js";
import { TwilioTesterError, TwilioTesterTransport } from "./transport/twilio-tester.js";
import type { InboundSmsEvent } from "./transport/types.js";

type PluginRuntime = OpenClawPluginApi["runtime"];

type SmsInboxBridgeServiceParams = {
  config: OpenClawConfig;
  logger: PluginLogger;
  pluginConfig: ResolvedSmsBridgePluginConfig;
  runtime: PluginRuntime;
};

type TesterLane = {
  inboundHandler: SmsInboundHandler;
  outboundMirror: SmsOutboundMirror;
  pluginConfig: ResolvedSmsBridgePluginConfig;
  twilioTransport: TwilioTesterTransport;
};

function createTesterPluginConfig(
  pluginConfig: ResolvedSmsBridgePluginConfig,
): ResolvedSmsBridgePluginConfig {
  if (!pluginConfig.tester.enabled) {
    throw new Error("sms-inbox-bridge tester lane requires tester.enabled=true");
  }
  return {
    ...pluginConfig,
    binding: {
      sessionKey: pluginConfig.tester.sessionKey,
      phoneNumber: pluginConfig.tester.phoneNumber,
    },
    tester: {
      enabled: false,
      routePath: pluginConfig.tester.routePath,
      sessionKey: pluginConfig.tester.sessionKey,
      phoneNumber: pluginConfig.tester.phoneNumber,
    },
  };
}

function readBearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(.+)$/i.exec(value ?? "");
  return match?.[1]?.trim();
}

function readTesterSecret(req: IncomingMessage): string | undefined {
  const header = req.headers["x-sms-bridge-tester-secret"];
  const headerSecret = Array.isArray(header) ? header[0] : header;
  return headerSecret?.trim() || readBearerToken(req.headers.authorization);
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export class SmsInboxBridgeService {
  private readonly transport: AndroidGatewayTransport;
  private readonly outboundMirror: SmsOutboundMirror;
  private readonly inboundHandler: SmsInboundHandler;
  private readonly testerLane?: TesterLane;
  private inboxRecoveryCursorMs?: number;
  private inboxRecoveryInFlight = false;
  private inboxRecoveryTimer?: ReturnType<typeof setInterval>;
  private unsubscribeTranscript?: () => void;

  constructor(private readonly params: SmsInboxBridgeServiceParams) {
    this.transport = new AndroidGatewayTransport({
      config: this.params.pluginConfig.transport,
    });
    this.outboundMirror = new SmsOutboundMirror({
      logger: this.params.logger,
      pluginConfig: this.params.pluginConfig,
      resolveBoundSession: () =>
        resolveBoundSessionState({
          config: this.params.config,
          pluginConfig: this.params.pluginConfig,
          runtime: this.params.runtime,
        }),
      transport: this.transport,
    });
    this.inboundHandler = new SmsInboundHandler({
      config: this.params.config,
      logger: this.params.logger,
      pluginConfig: this.params.pluginConfig,
      runtime: this.params.runtime,
      onProcessingError: async (event) => {
        await this.transport.sendText({
          text: `OpenClaw could not process the SMS from ${event.from}. Check the gateway logs.`,
          to: this.params.pluginConfig.binding.phoneNumber,
        });
      },
    });
    if (this.params.pluginConfig.tester.enabled) {
      const testerPluginConfig = createTesterPluginConfig(this.params.pluginConfig);
      const twilioTransport = new TwilioTesterTransport({
        config: this.params.pluginConfig.tester.twilio,
      });
      const testerOutboundMirror = new SmsOutboundMirror({
        logger: this.params.logger,
        pluginConfig: testerPluginConfig,
        resolveBoundSession: () =>
          resolveBoundSessionState({
            config: this.params.config,
            pluginConfig: testerPluginConfig,
            runtime: this.params.runtime,
          }),
        transport: this.transport,
      });
      const testerInboundHandler = new SmsInboundHandler({
        config: this.params.config,
        logger: this.params.logger,
        pluginConfig: testerPluginConfig,
        runtime: this.params.runtime,
        onProcessingError: async (event) => {
          await this.transport.sendText({
            text: `OpenClaw could not process the SMS tester message from ${event.from}. Check the gateway logs.`,
            to: testerPluginConfig.binding.phoneNumber,
          });
        },
      });
      this.testerLane = {
        inboundHandler: testerInboundHandler,
        outboundMirror: testerOutboundMirror,
        pluginConfig: testerPluginConfig,
        twilioTransport,
      };
    }
  }

  async start(): Promise<void> {
    if (!this.unsubscribeTranscript) {
      this.unsubscribeTranscript = this.params.runtime.events.onSessionTranscriptUpdate((update) => {
        this.outboundMirror.handleTranscriptUpdate(update);
        this.testerLane?.outboundMirror.handleTranscriptUpdate(update);
      });
    }
    this.params.logger.info(
      `sms-inbox-bridge started for ${this.params.pluginConfig.binding.sessionKey} at ${this.params.pluginConfig.transport.webhookPath}`,
    );
    if (this.params.pluginConfig.tester.enabled) {
      this.params.logger.info(
        `sms-inbox-bridge Twilio tester started for ${this.params.pluginConfig.tester.sessionKey} at ${this.params.pluginConfig.tester.routePath}`,
      );
    }
    this.startInboxRecoveryPolling();
  }

  async stop(): Promise<void> {
    if (this.inboxRecoveryTimer) {
      clearInterval(this.inboxRecoveryTimer);
      this.inboxRecoveryTimer = undefined;
    }
    this.unsubscribeTranscript?.();
    this.unsubscribeTranscript = undefined;
  }

  createHumanAlertTool() {
    return createHumanAlertTool({
      logger: this.params.logger,
      pluginConfig: this.params.pluginConfig,
      transport: this.transport,
    });
  }

  private enqueueInboundEvent(event: InboundSmsEvent): void {
    if (
      this.testerLane &&
      isAuthorizedPhoneNumber(event.from, this.testerLane.pluginConfig.binding.phoneNumber)
    ) {
      this.testerLane.inboundHandler.enqueue(event);
      return;
    }
    this.inboundHandler.enqueue(event);
  }

  private startInboxRecoveryPolling(): void {
    const recovery = this.params.pluginConfig.inboundRecovery;
    if (!recovery.enabled || this.inboxRecoveryTimer) {
      return;
    }
    if (this.params.pluginConfig.transport.serverMode !== "local") {
      this.params.logger.warn(
        "sms-inbox-bridge inbound recovery polling is only supported in Android Gateway Local Server mode",
      );
      return;
    }
    if (!this.params.pluginConfig.transport.deviceId) {
      this.params.logger.warn(
        "sms-inbox-bridge inbound recovery polling requires transport.deviceId",
      );
      return;
    }

    const now = Date.now();
    this.inboxRecoveryCursorMs = recovery.catchUpOnStart
      ? now - recovery.lookbackMinutes * 60 * 1000
      : now - recovery.safetyLagMs;

    const tick = () => {
      void this.runInboxRecoveryExport();
    };
    tick();
    this.inboxRecoveryTimer = setInterval(tick, recovery.pollIntervalMs);
    this.params.logger.info(
      `sms-inbox-bridge inbound recovery polling enabled every ${recovery.pollIntervalMs}ms`,
    );
  }

  private async runInboxRecoveryExport(): Promise<void> {
    if (this.inboxRecoveryInFlight) {
      return;
    }

    const recovery = this.params.pluginConfig.inboundRecovery;
    const until = Date.now() - recovery.safetyLagMs;
    const since = this.inboxRecoveryCursorMs ?? until;
    if (until <= since) {
      return;
    }

    this.inboxRecoveryInFlight = true;
    try {
      await this.transport.requestInboxExport({ since, until });
      this.inboxRecoveryCursorMs = until + 1;
      this.params.logger.debug?.(
        `sms-inbox-bridge requested inbox export from ${new Date(since).toISOString()} to ${new Date(until).toISOString()}`,
      );
    } catch (error) {
      this.params.logger.warn(
        `sms-inbox-bridge inbox export recovery failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.inboxRecoveryInFlight = false;
    }
  }

  async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("Method Not Allowed");
      return true;
    }

    const rawBody = (await buffer(req)).toString("utf8");
    try {
      const parsed = this.transport.parseWebhook({
        headers: req.headers,
        rawBody,
      });

      if (parsed.kind === "ignore") {
        res.statusCode = 202;
        res.end("ignored");
        return true;
      }

      this.enqueueInboundEvent(parsed.event);
      res.statusCode = 202;
      res.end("accepted");
      return true;
    } catch (error) {
      const statusCode =
        error instanceof SmsBridgeWebhookError ? error.statusCode : 500;
      this.params.logger.error(
        `sms-inbox-bridge rejected webhook with status ${statusCode}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      res.statusCode = statusCode;
      res.end(statusCode === 500 ? "internal error" : "invalid webhook");
      return true;
    }
  }

  async handleTesterHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!this.params.pluginConfig.tester.enabled || !this.testerLane) {
      res.statusCode = 404;
      res.end("Not Found");
      return true;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("Method Not Allowed");
      return true;
    }
    const expectedSecret = this.params.pluginConfig.tester.sharedSecret;
    const suppliedSecret = readTesterSecret(req);
    if (!suppliedSecret || !constantTimeEquals(suppliedSecret, expectedSecret)) {
      res.statusCode = 401;
      res.end("Unauthorized");
      return true;
    }

    const rawBody = (await buffer(req)).toString("utf8");
    try {
      const parsed = this.testerLane.twilioTransport.parseWebhook({
        headers: req.headers,
        rawBody,
      });
      if (parsed.kind === "ignore") {
        res.statusCode = 202;
        res.end("ignored");
        return true;
      }
      this.testerLane.inboundHandler.enqueue(parsed.event);
      res.statusCode = 202;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          accepted: true,
          externalId: parsed.event.externalId,
          from: parsed.event.from,
          sessionKey: this.testerLane.pluginConfig.binding.sessionKey,
        }),
      );
      return true;
    } catch (error) {
      const statusCode =
        error instanceof TwilioTesterError ? error.statusCode : 500;
      this.params.logger.error(
        `sms-inbox-bridge Twilio tester request failed with status ${statusCode}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      res.statusCode = statusCode;
      res.end(statusCode === 500 ? "internal error" : "invalid tester request");
      return true;
    }
  }
}

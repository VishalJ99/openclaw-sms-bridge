import { buffer } from "node:stream/consumers";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi, OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import { resolveBoundSessionState } from "./binding.js";
import type { ResolvedSmsBridgePluginConfig } from "./config.js";
import { SmsInboundHandler } from "./inbound.js";
import { SmsOutboundMirror } from "./outbound.js";
import { AndroidGatewayTransport, SmsBridgeWebhookError } from "./transport/android-gateway.js";

type PluginRuntime = OpenClawPluginApi["runtime"];

type SmsInboxBridgeServiceParams = {
  config: OpenClawConfig;
  logger: PluginLogger;
  pluginConfig: ResolvedSmsBridgePluginConfig;
  runtime: PluginRuntime;
};

export class SmsInboxBridgeService {
  private readonly transport: AndroidGatewayTransport;
  private readonly outboundMirror: SmsOutboundMirror;
  private readonly inboundHandler: SmsInboundHandler;
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
  }

  async start(): Promise<void> {
    if (!this.unsubscribeTranscript) {
      this.unsubscribeTranscript = this.params.runtime.events.onSessionTranscriptUpdate((update) => {
        this.outboundMirror.handleTranscriptUpdate(update);
      });
    }
    this.params.logger.info(
      `sms-inbox-bridge started for ${this.params.pluginConfig.binding.sessionKey} at ${this.params.pluginConfig.transport.webhookPath}`,
    );
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

      this.inboundHandler.enqueue(parsed.event);
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
}

import { buffer } from "node:stream/consumers";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi, OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
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
  private unsubscribeTranscript?: () => void;

  constructor(private readonly params: SmsInboxBridgeServiceParams) {
    this.transport = new AndroidGatewayTransport({
      config: this.params.pluginConfig.transport,
    });
    this.outboundMirror = new SmsOutboundMirror({
      logger: this.params.logger,
      pluginConfig: this.params.pluginConfig,
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
  }

  async stop(): Promise<void> {
    this.unsubscribeTranscript?.();
    this.unsubscribeTranscript = undefined;
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

import crypto from "node:crypto";
import type { OpenClawPluginApi, OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { ResolvedSmsBridgePluginConfig } from "./config.js";
import {
  isAuthorizedPhoneNumber,
  persistBoundSessionState,
  resolveBoundSessionState,
} from "./binding.js";
import type { InboundSmsEvent } from "./transport/types.js";

type PluginRuntime = OpenClawPluginApi["runtime"];

type SmsInboundHandlerParams = {
  config: OpenClawConfig;
  logger: PluginLogger;
  onProcessingError: (event: InboundSmsEvent, error: unknown) => Promise<void>;
  pluginConfig: ResolvedSmsBridgePluginConfig;
  runtime: PluginRuntime;
};

export class SmsInboundHandler {
  private readonly completedEventIds: string[] = [];
  private readonly completedEventIdSet = new Set<string>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly params: SmsInboundHandlerParams) {}

  enqueue(event: InboundSmsEvent): void {
    if (this.completedEventIdSet.has(event.externalId) || this.inFlight.has(event.externalId)) {
      return;
    }

    const run = this.tail
      .catch(() => undefined)
      .then(async () => {
        await this.processInbound(event);
        this.markCompleted(event.externalId);
      })
      .catch(async (error) => {
        this.params.logger.error(
          `sms-inbox-bridge inbound processing failed for ${event.from} (${event.externalId}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await this.params.onProcessingError(event, error);
        throw error;
      })
      .finally(() => {
        this.inFlight.delete(event.externalId);
      });

    this.tail = run.catch(() => undefined);
    this.inFlight.set(event.externalId, run);
  }

  private markCompleted(externalId: string): void {
    this.completedEventIdSet.add(externalId);
    this.completedEventIds.push(externalId);
    while (this.completedEventIds.length > 200) {
      const removed = this.completedEventIds.shift();
      if (removed) {
        this.completedEventIdSet.delete(removed);
      }
    }
  }

  private async processInbound(event: InboundSmsEvent): Promise<void> {
    if (
      !isAuthorizedPhoneNumber(event.from, this.params.pluginConfig.binding.phoneNumber)
    ) {
      this.params.logger.warn(
        `sms-inbox-bridge ignored inbound SMS from an unknown sender: ${event.from}`,
      );
      return;
    }

    const boundSession = resolveBoundSessionState({
      config: this.params.config,
      pluginConfig: this.params.pluginConfig,
      runtime: this.params.runtime,
    });

    await persistBoundSessionState({
      config: this.params.config,
      pluginConfig: this.params.pluginConfig,
      runtime: this.params.runtime,
      state: boundSession,
      updatedAt: event.receivedAt,
    });

    const workspaceDir = this.params.runtime.agent.resolveAgentWorkspaceDir(
      this.params.config,
      boundSession.agentId,
    );
    const agentDir = this.params.runtime.agent.resolveAgentDir(
      this.params.config,
      boundSession.agentId,
    );
    await this.params.runtime.agent.ensureAgentWorkspace({
      dir: workspaceDir,
    });

    await this.params.runtime.agent.runEmbeddedAgent({
      agentId: boundSession.agentId,
      allowGatewaySubagentBinding: true,
      messageChannel: "sms",
      messageProvider: "sms-inbox-bridge",
      prompt: event.text,
      runId: crypto.randomUUID(),
      senderE164: event.from,
      senderId: event.from,
      senderIsOwner: true,
      senderName: event.from,
      sessionFile: boundSession.sessionFile,
      sessionId: boundSession.sessionId,
      sessionKey: boundSession.sessionKey,
      ...(boundSession.modelProvider && boundSession.modelId
        ? {
            provider: boundSession.modelProvider,
            model: boundSession.modelId,
          }
        : {}),
      timeoutMs: this.params.runtime.agent.resolveAgentTimeoutMs({
        cfg: this.params.config,
      }),
      trigger: "user",
      workspaceDir,
      agentDir,
    });

    await persistBoundSessionState({
      config: this.params.config,
      pluginConfig: this.params.pluginConfig,
      runtime: this.params.runtime,
      state: boundSession,
    });
  }
}

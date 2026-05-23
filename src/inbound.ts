import crypto from "node:crypto";
import type { OpenClawPluginApi, OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { ResolvedSmsBridgePluginConfig } from "./config.js";
import {
  isAuthorizedPhoneNumber,
  persistBoundSessionState,
  resolveBoundSessionState,
} from "./binding.js";
import { routeGatewayTextSlashCommandIfSupported } from "./slash-commands.js";
import type { InboundSmsEvent } from "./transport/types.js";

type PluginRuntime = OpenClawPluginApi["runtime"];

type SmsInboundHandlerParams = {
  config: OpenClawConfig;
  logger: PluginLogger;
  onProcessingError: (event: InboundSmsEvent, error: unknown) => Promise<void>;
  pluginConfig: ResolvedSmsBridgePluginConfig;
  runtime: PluginRuntime;
};

const RECENT_DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

function normalizePhoneForDuplicateKey(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

function normalizeTextForDuplicateKey(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function buildInboundDuplicateKey(event: InboundSmsEvent): string {
  return [
    normalizePhoneForDuplicateKey(event.from),
    normalizeTextForDuplicateKey(event.text),
  ].join("\n");
}

export class SmsInboundHandler {
  private readonly completedEventIds: string[] = [];
  private readonly completedEventIdSet = new Set<string>();
  private readonly completedDuplicateKeys: Array<{ key: string; receivedAt: number }> = [];
  private readonly completedDuplicateKeySeenAt = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly inFlightDuplicateKeys = new Set<string>();
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly params: SmsInboundHandlerParams) {}

  enqueue(event: InboundSmsEvent): void {
    const duplicateKey = buildInboundDuplicateKey(event);
    if (
      this.completedEventIdSet.has(event.externalId) ||
      this.inFlight.has(event.externalId) ||
      this.inFlightDuplicateKeys.has(duplicateKey) ||
      this.wasRecentlyCompletedDuplicate(duplicateKey, event.receivedAt)
    ) {
      return;
    }

    const run = this.tail
      .catch(() => undefined)
      .then(async () => {
        await this.processInbound(event);
        this.markCompleted(event.externalId, duplicateKey, event.receivedAt);
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
        this.inFlightDuplicateKeys.delete(duplicateKey);
      });

    this.tail = run.catch(() => undefined);
    this.inFlight.set(event.externalId, run);
    this.inFlightDuplicateKeys.add(duplicateKey);
  }

  private wasRecentlyCompletedDuplicate(duplicateKey: string, receivedAt: number): boolean {
    const previousReceivedAt = this.completedDuplicateKeySeenAt.get(duplicateKey);
    return (
      typeof previousReceivedAt === "number" &&
      Math.abs(receivedAt - previousReceivedAt) <= RECENT_DUPLICATE_WINDOW_MS
    );
  }

  private markCompleted(externalId: string, duplicateKey: string, receivedAt: number): void {
    this.completedEventIdSet.add(externalId);
    this.completedEventIds.push(externalId);
    while (this.completedEventIds.length > 200) {
      const removed = this.completedEventIds.shift();
      if (removed) {
        this.completedEventIdSet.delete(removed);
      }
    }

    this.completedDuplicateKeySeenAt.set(duplicateKey, receivedAt);
    this.completedDuplicateKeys.push({ key: duplicateKey, receivedAt });
    while (this.completedDuplicateKeys.length > 200) {
      const removed = this.completedDuplicateKeys.shift();
      if (removed && this.completedDuplicateKeySeenAt.get(removed.key) === removed.receivedAt) {
        this.completedDuplicateKeySeenAt.delete(removed.key);
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

    const routedSlashCommand = await routeGatewayTextSlashCommandIfSupported({
      agentId: boundSession.agentId,
      config: this.params.config,
      message: event.text,
      runId: event.externalId,
      sessionKey: boundSession.sessionKey,
    });
    if (routedSlashCommand) {
      await persistBoundSessionState({
        config: this.params.config,
        pluginConfig: this.params.pluginConfig,
        runtime: this.params.runtime,
        state: resolveBoundSessionState({
          config: this.params.config,
          pluginConfig: this.params.pluginConfig,
          runtime: this.params.runtime,
        }),
        updatedAt: event.receivedAt,
      });
      return;
    }

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
      ...(boundSession.authProfileId
        ? {
            authProfileId: boundSession.authProfileId,
            authProfileIdSource: boundSession.authProfileIdSource,
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
    this.params.logger.info(
      `sms-inbox-bridge bound session inbound processed (${event.externalId}) session=${boundSession.sessionKey}`,
    );
  }
}

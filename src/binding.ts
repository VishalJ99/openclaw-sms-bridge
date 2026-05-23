import crypto from "node:crypto";
import path from "node:path";
import type { OpenClawPluginApi, OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";
import { normalizePhoneNumber, type ResolvedSmsBridgePluginConfig } from "./config.js";

type PluginRuntime = OpenClawPluginApi["runtime"];

export type BoundSessionState = {
  agentId: string;
  sessionKey: string;
  sessionId: string;
  sessionFile: string;
  storePath: string;
  modelProvider?: string;
  modelId?: string;
  authProfileId?: string;
  authProfileIdSource?: "auto" | "user";
};

type SessionStoreEntryLike = {
  provider?: unknown;
  model?: unknown;
  authProfileOverride?: unknown;
  authProfileOverrideSource?: unknown;
};

type ModelSelection = {
  provider?: string;
  model?: string;
};

function resolveAgentIdFromBoundSessionKey(sessionKey: string): string {
  const match = /^agent:([^:]+):/i.exec(sessionKey.trim());
  if (!match?.[1]) {
    throw new Error(
      `sms-inbox-bridge requires a full agent session key like "agent:main:main", got "${sessionKey}"`,
    );
  }
  return match[1];
}

export function isAuthorizedPhoneNumber(input: string, trustedPhoneNumber: string): boolean {
  return normalizePhoneNumber(input) === normalizePhoneNumber(trustedPhoneNumber);
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readAuthProfileOverrideSource(value: unknown): "auto" | "user" | undefined {
  return value === "auto" || value === "user" ? value : undefined;
}

function parseModelRef(ref: string | undefined): ModelSelection {
  const trimmed = readNonEmptyString(ref);
  if (!trimmed) {
    return {};
  }
  const separatorIndex = trimmed.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return {};
  }
  return {
    provider: trimmed.slice(0, separatorIndex),
    model: trimmed.slice(separatorIndex + 1),
  };
}

export function resolveBoundSessionModelSelection(params: {
  agentId: string;
  config: OpenClawConfig;
  existing?: SessionStoreEntryLike;
}): ModelSelection {
  const provider = readNonEmptyString(params.existing?.provider);
  const model = readNonEmptyString(params.existing?.model);
  if (provider && model) {
    return { provider, model };
  }

  const configWithAgents = params.config as OpenClawConfig & {
    agents?: {
      defaults?: {
        model?: {
          primary?: string;
        };
      };
      entries?: Record<
        string,
        {
          model?: {
            primary?: string;
          };
        }
      >;
    };
  };

  const agentPrimary = readNonEmptyString(
    configWithAgents.agents?.entries?.[params.agentId]?.model?.primary,
  );
  const defaultPrimary = readNonEmptyString(configWithAgents.agents?.defaults?.model?.primary);
  return parseModelRef(agentPrimary ?? defaultPrimary);
}

export function resolveBoundSessionState(params: {
  config: OpenClawConfig;
  pluginConfig: ResolvedSmsBridgePluginConfig;
  runtime: PluginRuntime;
}): BoundSessionState {
  const agentId = resolveAgentIdFromBoundSessionKey(params.pluginConfig.binding.sessionKey);
  const storePath = params.runtime.agent.session.resolveStorePath(params.config.session?.store, {
    agentId,
  });
  const store = params.runtime.agent.session.loadSessionStore(storePath);
  const existing = store[params.pluginConfig.binding.sessionKey];
  const sessionId = existing?.sessionId ?? crypto.randomUUID();
  const sessionFile = params.runtime.agent.session.resolveSessionFilePath(sessionId, existing, {
    agentId,
    sessionsDir: path.dirname(storePath),
  });
  const modelSelection = resolveBoundSessionModelSelection({
    agentId,
    config: params.config,
    existing,
  });
  return {
    agentId,
    sessionKey: params.pluginConfig.binding.sessionKey,
    sessionId,
    sessionFile,
    storePath,
    modelProvider: modelSelection.provider,
    modelId: modelSelection.model,
    authProfileId: readNonEmptyString(existing?.authProfileOverride),
    authProfileIdSource: readAuthProfileOverrideSource(existing?.authProfileOverrideSource),
  };
}

export async function persistBoundSessionState(params: {
  config: OpenClawConfig;
  pluginConfig: ResolvedSmsBridgePluginConfig;
  runtime: PluginRuntime;
  updatedAt?: number;
  state?: BoundSessionState;
}): Promise<BoundSessionState> {
  const state =
    params.state ??
    resolveBoundSessionState({
      config: params.config,
      pluginConfig: params.pluginConfig,
      runtime: params.runtime,
    });
  const store = params.runtime.agent.session.loadSessionStore(state.storePath);
  const existing = store[state.sessionKey];
  store[state.sessionKey] = {
    ...existing,
    sessionId: state.sessionId,
    sessionFile: state.sessionFile,
    updatedAt: params.updatedAt ?? Date.now(),
    origin: {
      ...existing?.origin,
      provider: "sms-inbox-bridge",
      surface: "sms",
      from: params.pluginConfig.binding.phoneNumber,
    },
  };
  await params.runtime.agent.session.saveSessionStore(state.storePath, store);
  return state;
}

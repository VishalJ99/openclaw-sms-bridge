import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";
import { GatewayClient } from "openclaw/plugin-sdk/gateway-runtime";

const DEFAULT_GATEWAY_PORT = 18789;
const DEFAULT_GATEWAY_STOP_TIMEOUT_MS = 1_000;

type GatewayCommandEntry = {
  textAliases?: unknown;
  acceptsArgs?: unknown;
};

type GatewayCommandsListResult = {
  commands?: GatewayCommandEntry[];
};

type GatewayLoopbackConnection = {
  url: string;
  token?: string;
  password?: string;
};

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeSlashAlias(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("/") ? trimmed : null;
}

function readGatewayPort(config: OpenClawConfig): number {
  const configWithGateway = config as OpenClawConfig & {
    gateway?: {
      port?: unknown;
    };
  };
  const rawPort = configWithGateway.gateway?.port;
  if (typeof rawPort !== "number" || !Number.isFinite(rawPort)) {
    return DEFAULT_GATEWAY_PORT;
  }
  const normalized = Math.floor(rawPort);
  return normalized > 0 ? normalized : DEFAULT_GATEWAY_PORT;
}

export function isSlashCommandMessage(message: string): boolean {
  return message.trim().startsWith("/");
}

export function matchesTextSlashCommand(message: string, command: GatewayCommandEntry): boolean {
  const trimmed = message.trim().toLowerCase();
  if (!trimmed.startsWith("/")) {
    return false;
  }
  const acceptsArgs = command.acceptsArgs === true;
  const aliases = Array.isArray(command.textAliases) ? command.textAliases : [];
  for (const alias of aliases) {
    if (typeof alias !== "string") {
      continue;
    }
    const normalizedAlias = normalizeSlashAlias(alias);
    if (!normalizedAlias) {
      continue;
    }
    if (trimmed === normalizedAlias) {
      return true;
    }
    if (acceptsArgs && trimmed.startsWith(`${normalizedAlias} `)) {
      return true;
    }
  }
  return false;
}

export function isSupportedTextSlashCommand(
  message: string,
  commands: GatewayCommandEntry[],
): boolean {
  if (!isSlashCommandMessage(message)) {
    return false;
  }
  return commands.some((command) => matchesTextSlashCommand(message, command));
}

export function resolveGatewayLoopbackConnection(config: OpenClawConfig): GatewayLoopbackConnection {
  const configWithGateway = config as OpenClawConfig & {
    gateway?: {
      auth?: {
        mode?: unknown;
        token?: unknown;
        password?: unknown;
      };
    };
  };
  const authMode = readNonEmptyString(configWithGateway.gateway?.auth?.mode)?.toLowerCase();
  const token = readNonEmptyString(configWithGateway.gateway?.auth?.token);
  const password = readNonEmptyString(configWithGateway.gateway?.auth?.password);
  if (authMode === "token" && !token) {
    throw new Error(
      "sms-inbox-bridge slash commands require gateway.auth.token when gateway.auth.mode=token",
    );
  }
  if (authMode === "password" && !password) {
    throw new Error(
      "sms-inbox-bridge slash commands require gateway.auth.password when gateway.auth.mode=password",
    );
  }
  return {
    url: `ws://127.0.0.1:${String(readGatewayPort(config))}`,
    ...(token ? { token } : {}),
    ...(password ? { password } : {}),
  };
}

async function withLoopbackGatewayClient<T>(
  config: OpenClawConfig,
  run: (client: GatewayClient) => Promise<T>,
): Promise<T> {
  const connection = resolveGatewayLoopbackConnection(config);
  let settleReady:
    | {
        resolve: () => void;
        reject: (error: unknown) => void;
        settled: boolean;
      }
    | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    settleReady = { resolve, reject, settled: false };
  });
  const client = new GatewayClient({
    ...connection,
    clientDisplayName: "sms-inbox-bridge",
    onHelloOk: () => {
      if (settleReady?.settled) {
        return;
      }
      settleReady!.settled = true;
      settleReady!.resolve();
    },
    onConnectError: (error) => {
      if (settleReady?.settled) {
        return;
      }
      settleReady!.settled = true;
      settleReady!.reject(error);
    },
    onClose: (_code, reason) => {
      if (settleReady?.settled) {
        return;
      }
      settleReady!.settled = true;
      settleReady!.reject(new Error(`gateway connection closed before ready: ${reason || "unknown"}`));
    },
  });
  client.start();
  try {
    await ready;
    return await run(client);
  } finally {
    try {
      await client.stopAndWait({ timeoutMs: DEFAULT_GATEWAY_STOP_TIMEOUT_MS });
    } catch {
      client.stop();
    }
  }
}

export async function routeGatewayTextSlashCommandIfSupported(params: {
  agentId: string;
  config: OpenClawConfig;
  message: string;
  runId: string;
  sessionKey: string;
}): Promise<boolean> {
  if (!isSlashCommandMessage(params.message)) {
    return false;
  }
  return await withLoopbackGatewayClient(params.config, async (client) => {
    const listed = await client.request<GatewayCommandsListResult>("commands.list", {
      agentId: params.agentId,
      scope: "text",
    });
    const commands = Array.isArray(listed.commands) ? listed.commands : [];
    if (!isSupportedTextSlashCommand(params.message, commands)) {
      return false;
    }
    await client.request("chat.send", {
      sessionKey: params.sessionKey,
      message: params.message,
      idempotencyKey: params.runId,
    });
    return true;
  });
}

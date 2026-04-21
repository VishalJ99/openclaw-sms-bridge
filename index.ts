import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createSmsBridgePluginConfigSchema, resolveSmsBridgePluginConfig } from "./src/config.js";
import { SmsInboxBridgeService } from "./src/service.js";

const PLUGIN_ID = "sms-inbox-bridge";

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "SMS Inbox Bridge",
  description: "Bind one phone number to one OpenClaw session and mirror that session over SMS.",
  configSchema: createSmsBridgePluginConfigSchema(),
  register(api) {
    if (api.registrationMode !== "full") {
      return;
    }
    if (api.pluginConfig === undefined) {
      return;
    }

    const pluginConfig = resolveSmsBridgePluginConfig(api.pluginConfig);
    const service = new SmsInboxBridgeService({
      config: api.config,
      logger: api.logger,
      pluginConfig,
      runtime: api.runtime,
    });

    api.registerHttpRoute({
      path: pluginConfig.transport.webhookPath,
      auth: "plugin",
      match: "exact",
      handler: async (req, res) => await service.handleHttpRequest(req, res),
    });

    if (pluginConfig.alert.enabled) {
      api.registerTool(service.createHumanAlertTool());
    }

    api.registerService({
      id: `${PLUGIN_ID}:service`,
      start: async () => {
        await service.start();
      },
      stop: async () => {
        await service.stop();
      },
    });
  },
});

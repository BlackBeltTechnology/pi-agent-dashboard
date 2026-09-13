/**
 * Plugin config REST routes.
 *
 * POST /api/config/plugins/:id — write a partial plugin config.
 * Validates against the plugin's configSchema (if declared).
 * Broadcasts plugin_config_update to all subscribed browsers.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applySchemaDefaults,
  discoverPlugins,
  getPluginStatusStore,
  redactWriteOnly,
  validatePluginConfig,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { FastifyInstance } from "fastify";
import type { NetworkGuard } from "./route-deps.js";

const CONFIG_DIR = path.join(os.homedir(), ".pi", "dashboard");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

function readRawConfig(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeRawConfig(merged: Record<string, unknown>): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tmpFile = CONFIG_FILE + ".tmp." + process.pid;
  fs.writeFileSync(tmpFile, JSON.stringify(merged, null, 2) + "\n");
  fs.renameSync(tmpFile, CONFIG_FILE);
}

function loadSchemaForPlugin(
  pluginId: string,
  repoRoot?: string,
): Record<string, unknown> | null {
  const plugins = discoverPlugins(repoRoot);
  const plugin = plugins.find(p => p.manifest.id === pluginId);
  if (!plugin?.manifest.configSchema) return null;
  const schemaPath = path.resolve(plugin.packageDir, plugin.manifest.configSchema);
  try {
    return JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
  } catch {
    return null;
  }
}

export function registerPluginConfigRoutes(
  fastify: FastifyInstance,
  deps: {
    networkGuard: NetworkGuard;
    broadcast: (msg: ServerToBrowserMessage) => void;
    repoRoot?: string;
  },
) {
  const { networkGuard, broadcast, repoRoot } = deps;

  fastify.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/config/plugins/:id",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { id } = request.params;

      const store = getPluginStatusStore();
      const status = store.getStatus(id);

      if (!status) {
        return reply.status(404).send({ success: false, error: `Plugin "${id}" not found` });
      }

      if (!status.enabled) {
        return reply.status(409).send({
          success: false,
          error: `Plugin "${id}" is disabled. Enable it before writing config.`,
        });
      }

      const body = request.body ?? {};

      // Validate against schema if the plugin has one
      const schema = loadSchemaForPlugin(id, repoRoot);
      if (schema) {
        try {
          validatePluginConfig(id, body as Record<string, unknown>, schema);
        } catch (e: unknown) {
          return reply.status(400).send({
            success: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      // Read existing config, merge, write
      const existing = readRawConfig();
      const existingPlugins = (existing.plugins as Record<string, unknown> | undefined) ?? {};
      const existingPluginConfig =
        (existingPlugins[id] as Record<string, unknown> | undefined) ?? {};

      let merged = { ...existingPluginConfig, ...body };

      // Apply schema defaults to merged result
      if (schema) {
        merged = applySchemaDefaults(merged, schema);
      }

      const updatedPlugins = { ...existingPlugins, [id]: merged };
      const updatedConfig = { ...existing, plugins: updatedPlugins };
      writeRawConfig(updatedConfig);

      // Broadcast to all subscribed browsers. writeOnly fields (e.g. the
      // browser plugin's per-profile SSO tokens) are stripped first — they
      // must never cross to a client, and neither may the POST response echo
      // one back. Spec add-browser-relay, browser-plugin-settings F2 / GAP A.
      const outbound = schema ? redactWriteOnly(merged, schema) : merged;
      broadcast({
        type: "plugin_config_update",
        id,
        config: outbound,
      });

      return reply.status(200).send({ success: true, config: outbound });
    },
  );
}

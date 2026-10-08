/**
 * context-mode-settings-plugin · SERVER entry.
 *
 *   GET  /api/plugins/context-mode-settings/config → effective + default + isDefault per key
 *   PUT  /api/plugins/context-mode-settings/config → validate, then atomic full-write
 *
 * Also registers a spawn-env contributor that projects the file (storage +
 * runtime scope) into every dashboard-spawned pi session, read fresh per spawn.
 * Logs never include setting values (paths may be sensitive).
 *
 * See change: add-context-mode-settings-plugin.
 */

import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { PROJECTED_MARKER_ENV, projectEnv, RUNTIME_ENV_NAMES, validateSettings } from "../shared/settings-descriptors.js";
import { readEffectiveSettings, readSettingsFile, resolveSettingsPath, writeSettingsFile } from "./settings-io.js";

export interface RouteLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export const ROUTE = "/api/plugins/context-mode-settings/config";

export async function registerContextModeRoutes(
  fastify: FastifyInstance,
  deps: { logger: RouteLogger; filePath?: () => string },
): Promise<void> {
  const { logger } = deps;
  const pathOf = deps.filePath ?? (() => resolveSettingsPath());
  // Scoped rate limit (loopback allow-listed): the PUT touches the filesystem.
  await fastify.register(async (scope) => {
    await scope.register(rateLimit, { global: true, max: 100_000, timeWindow: "1 minute", allowList: ["127.0.0.1", "::1"] });

    scope.get(ROUTE, async () => {
      const filePath = pathOf();
      const eff = readEffectiveSettings(filePath);
      logger.info(`context-mode-settings read exists=${eff.exists} fields=${Object.keys(eff.fields).length}`);
      return eff;
    });

    scope.put<{ Body: unknown }>(ROUTE, async (req, reply) => {
      const filePath = pathOf();
      const body = req.body;
      const result = validateSettings(body);
      if (!result.ok) {
        logger.warn(`context-mode-settings write rejected invalidKeys=${result.errors.map((e) => e.key || "body").join(",")}`);
        reply.code(400);
        return { error: "invalid_settings", errors: result.errors };
      }
      try {
        writeSettingsFile(filePath, body as Record<string, unknown>);
      } catch (e) {
        logger.error(`context-mode-settings write failed code=${(e as NodeJS.ErrnoException).code ?? "unknown"}`);
        reply.code(500);
        return { error: "write_failed" };
      }
      logger.info(`context-mode-settings wrote fields=${Object.keys(body as Record<string, unknown>).length}`);
      return readEffectiveSettings(filePath);
    });
  });
}

/**
 * Build the contributor fn: reads the file fresh each call, projects both
 * scopes, nothing for wsl-tmux (the guest has its own home + bridge). Invalid
 * entries are dropped individually with a warning; a corrupt file contributes
 * nothing.
 */
export function createSpawnEnvContributor(deps: { logger: RouteLogger; filePath?: () => string }) {
  const pathOf = deps.filePath ?? (() => resolveSettingsPath());
  return ({ mechanism }: { mechanism: "headless" | "tmux" | "wt" | "wsl-tmux" }): Record<string, string> => {
    if (mechanism === "wsl-tmux") return {};
    const r = readSettingsFile(pathOf());
    if (r.state === "corrupt") {
      deps.logger.warn(`context-mode-settings unreadable file; contributing nothing reason=${r.reason}`);
      return {};
    }
    return projectEnv(r.settings, {
      scopes: ["storage", "runtime"],
      onInvalid: (e) => deps.logger.warn(`context-mode-settings ignoring invalid key=${e.key} error=${e.error}`),
    });
  };
}

async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("context-mode-settings-plugin server entry activated");
  await registerContextModeRoutes(ctx.fastify, { logger: ctx.logger });
  ctx.registerSpawnEnvContributor?.(createSpawnEnvContributor({ logger: ctx.logger }), {
    supersede: { marker: PROJECTED_MARKER_ENV, names: RUNTIME_ENV_NAMES },
  });
}

export default registerPlugin;

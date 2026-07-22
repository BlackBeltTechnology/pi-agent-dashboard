/**
 * hermes-memory-plugin · SERVER entry.
 *
 * Registers two Fastify routes on the shared instance that read + write the
 * `pi-hermes-memory` extension's on-disk config file directly (the extension
 * exposes no config API — design D1):
 *
 *   GET  /api/plugins/hermes-memory/config → effective + default + isDefault per field
 *   PUT  /api/plugins/hermes-memory/config → validate, then atomic full-write
 *
 * The PUT route validates the browser-supplied body BEFORE any disk write
 * (`validateHermesConfig` — the security boundary, design D6): invalid → 400,
 * no write. Structured logging records path + field count on success and the
 * failure reason on error, NEVER field values (config may hold model/provider
 * hints — design D9).
 *
 * See change: add-hermes-memory-settings-plugin.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { FastifyInstance } from "fastify";
import { validateHermesConfig } from "../shared/hermes-config.js";
import { readEffectiveConfig, writeResolvedConfig } from "./config-io.js";
import { resolveHermesConfigPath } from "./config-path.js";

/** Minimal structured logger surface (subset of PluginLogger). */
export interface RouteLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const ROUTE = "/api/plugins/hermes-memory/config";

/**
 * Mount the GET/PUT config routes on a Fastify instance. Factored out of
 * `registerPlugin` so it can be exercised against an injected Fastify instance
 * in tests.
 */
export function registerHermesRoutes(
  fastify: FastifyInstance,
  deps: { logger: RouteLogger; env?: Record<string, string | undefined> },
): void {
  const { logger, env } = deps;

  fastify.get(ROUTE, async () => {
    const filePath = resolveHermesConfigPath(env);
    const effective = readEffectiveConfig(filePath);
    logger.info(
      `hermes-memory config read path=${filePath} exists=${effective.exists} fields=${Object.keys(effective.fields).length}`,
    );
    return effective;
  });

  fastify.put<{ Body: unknown }>(ROUTE, async (req, reply) => {
    const filePath = resolveHermesConfigPath(env);
    const body = req.body;
    const result = validateHermesConfig(body);
    if (!result.ok) {
      const reason = result.errors.map((e) => e.field || "body").join(", ");
      logger.warn(`hermes-memory config write rejected path=${filePath} invalidFields=${reason}`);
      reply.code(400);
      return { error: "invalid config", errors: result.errors };
    }
    writeResolvedConfig(filePath, body as Record<string, unknown>);
    const fieldCount = Object.keys(body as Record<string, unknown>).length;
    logger.info(`hermes-memory config wrote path=${filePath} fields=${fieldCount}`);
    return readEffectiveConfig(filePath);
  });
}

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("hermes-memory-plugin server entry activated");
  registerHermesRoutes(ctx.fastify, { logger: ctx.logger });
}

export default registerPlugin;

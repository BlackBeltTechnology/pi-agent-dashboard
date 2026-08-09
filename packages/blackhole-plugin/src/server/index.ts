/**
 * blackhole-plugin · SERVER entry.
 *
 * Registers two Fastify routes that read + write the `pi-blackhole` extension's
 * on-disk config file directly — the filesystem is the entire integration
 * surface (the extension re-reads its config after every write, so there is no
 * API to call):
 *
 *   GET  /api/plugins/blackhole/config → effective + default + isDefault per
 *                                        managed key, plus the unmanaged keys
 *                                        present in the file — or a
 *                                        `parse-error` result (409, D6)
 *   PUT  /api/plugins/blackhole/config → validate, then read-modify-write
 *
 * The PUT route validates the browser-supplied body BEFORE any disk access
 * (`validateBlackholeConfig` — the security boundary): invalid → 400, no write,
 * no partial application. Structured logging records path + key count + the
 * failure reason, NEVER field values (the config holds provider/model hints).
 *
 * See change: add-blackhole-plugin.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { FastifyInstance } from "fastify";
import { validateBlackholeConfig } from "../shared/blackhole-config.js";
import { ConfigParseErrorOnWrite, readConfig, saveConfig } from "./config-io.js";
import { resolveBlackholeConfigPath } from "./config-path.js";

/** Minimal structured logger surface (subset of PluginLogger). */
export interface RouteLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const ROUTE = "/api/plugins/blackhole/config";

/**
 * Mount the GET/PUT config routes on a Fastify instance. Factored out of
 * `registerPlugin` so it can be exercised against an injected instance in tests.
 */
export function registerBlackholeRoutes(
  fastify: FastifyInstance,
  deps: { logger: RouteLogger; env?: Record<string, string | undefined> },
): void {
  const { logger, env } = deps;

  fastify.get(ROUTE, async (_req, reply) => {
    const filePath = resolveBlackholeConfigPath(env);
    const result = readConfig(filePath);
    if (result.status === "parse-error") {
      logger.warn(`blackhole config unparseable path=${filePath}`);
      reply.code(409);
      return result;
    }
    logger.info(
      `blackhole config read path=${filePath} exists=${result.exists} unmanagedKeys=${result.unmanagedKeys.length}`,
    );
    return result;
  });

  fastify.put<{ Body: unknown }>(ROUTE, async (req, reply) => {
    const filePath = resolveBlackholeConfigPath(env);
    const body = req.body;
    const validation = validateBlackholeConfig(body);
    if (!validation.ok) {
      const reason = validation.errors.map((e) => e.field || "body").join(", ");
      logger.warn(`blackhole config write rejected path=${filePath} invalidFields=${reason}`);
      reply.code(400);
      return { error: "invalid config", errors: validation.errors };
    }

    let saved: ReturnType<typeof saveConfig>;
    try {
      saved = saveConfig(filePath, body as Record<string, unknown>);
    } catch (e) {
      if (e instanceof ConfigParseErrorOnWrite) {
        logger.warn(`blackhole config write blocked (unparseable) path=${filePath}`);
        reply.code(409);
        return { error: "config file cannot be parsed", message: e.parserMessage };
      }
      const message = e instanceof Error ? e.message : String(e);
      logger.error(`blackhole config write failed path=${filePath} reason=${message}`);
      reply.code(500);
      return { error: "config write failed", message };
    }

    const keyCount = Object.keys(body as Record<string, unknown>).length;
    logger.info(
      `blackhole config wrote path=${filePath} keys=${keyCount} preservedUnmanaged=${saved.preservedUnmanagedKeys.length} externalWriteDetected=${saved.externalWriteDetected}`,
    );
    const after = readConfig(filePath);
    return { ...after, ...saved };
  });
}

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("blackhole-plugin server entry activated");
  registerBlackholeRoutes(ctx.fastify, { logger: ctx.logger });
}

export default registerPlugin;

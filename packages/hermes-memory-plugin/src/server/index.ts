/**
 * hermes-memory-plugin · SERVER entry.
 *
 * Registers two Fastify routes on the shared instance that read + write the
 * `pi-hermes-memory` extension's on-disk config file directly (the extension
 * exposes no config API — design D1):
 *
 *   GET  /api/plugins/hermes-memory/config → effective + default + isDefault per field
 *   PUT  /api/plugins/hermes-memory/config → validate, then compose + atomic write
 *        (preserves unknown on-disk keys, omits default-valued fields)
 *
 * The PUT route validates the browser-supplied body BEFORE any disk write
 * (`validateHermesConfig` — the security boundary, design D6): invalid → 400,
 * no write. Structured logging records path + field count on success and the
 * failure reason on error, NEVER field values (config may hold model/provider
 * hints — design D9). An unreadable file (or a failed quarantine copy of a
 * malformed one) maps to HTTP 500 `{ error, code }` on GET and PUT, no write.
 *
 * See change: add-hermes-memory-settings-plugin, resync-hermes-memory-config-0-9.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { FastifyInstance, FastifyReply } from "fastify";
import { validateHermesConfig } from "../shared/hermes-config.js";
import { HermesConfigError, readEffectiveConfig, type WriteDeps, writeResolvedConfig } from "./config-io.js";
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
  deps: {
    logger: RouteLogger;
    env?: Record<string, string | undefined>;
    /** Test seams for the quarantine path (clock, copy). */
    write?: Pick<WriteDeps, "now" | "writeQuarantine">;
  },
): void {
  const { logger, env } = deps;

  /** Map an unreadable-file / failed-quarantine error to 500; log path + code only. */
  const fail = (reply: FastifyReply, filePath: string, op: string, e: unknown) => {
    if (!(e instanceof HermesConfigError)) throw e;
    logger.error(`hermes-memory config ${op} failed path=${filePath} error="${e.error}" code=${e.code}`);
    reply.code(500);
    return { error: e.error, code: e.code };
  };

  fastify.get(ROUTE, async (_req, reply) => {
    const filePath = resolveHermesConfigPath(env);
    try {
      const effective = readEffectiveConfig(filePath);
      logger.info(
        `hermes-memory config read path=${filePath} exists=${effective.exists} fields=${Object.keys(effective.fields).length}`,
      );
      return effective;
    } catch (e) {
      return fail(reply, filePath, "read", e);
    }
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
    try {
      // Synchronous read → compose → atomic write (design D1 invariant).
      const written = writeResolvedConfig(filePath, body as Record<string, unknown>, {
        ...deps.write,
        log: (m) => logger.warn(m),
      });
      logger.info(`hermes-memory config wrote path=${filePath} fields=${Object.keys(written).length}`);
      return readEffectiveConfig(filePath);
    } catch (e) {
      return fail(reply, filePath, "write", e);
    }
  });
}

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("hermes-memory-plugin server entry activated");
  registerHermesRoutes(ctx.fastify, { logger: ctx.logger });
}

export default registerPlugin;

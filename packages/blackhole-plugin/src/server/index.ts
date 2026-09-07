/**
 * blackhole-plugin · SERVER entry.
 *
 * Registers four Fastify routes over the `pi-blackhole` extension's on-disk
 * files — the filesystem is the entire integration surface (the extension
 * re-reads its config after every write, so there is no API to call):
 *
 *   GET  /api/plugins/blackhole/config → effective + default + isDefault per
 *                                        managed key, plus the unmanaged keys
 *                                        present in the file — or a
 *                                        `parse-error` result (409, D6)
 *   PUT  /api/plugins/blackhole/config → validate, then read-modify-write
 *   GET  /api/plugins/blackhole/status → `{ installed }` for the client boot
 *                                        gate (design D1: registry capability
 *                                        authoritative; config-file existence
 *                                        only as degraded fallback)
 *   GET  /api/plugins/blackhole/session/:id → per-session pipeline state +
 *                                        the global fields the MEMORY subcard
 *                                        needs (design D5; read-only,
 *                                        validate-then-confine)
 *
 * The PUT route validates the browser-supplied body BEFORE any disk access
 * (`validateBlackholeConfig` — the security boundary): invalid → 400, no write,
 * no partial application. The session route validates the id against RFC 4122
 * syntax and confines the read path before any filesystem access, and never
 * writes. Structured logging records path + key count + the failure reason,
 * NEVER field values (the config holds provider/model hints).
 *
 * See change: add-blackhole-plugin, add-blackhole-session-pipeline.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { validateBlackholeConfig } from "../shared/blackhole-config.js";
import { ConfigParseErrorOnWrite, readConfig, saveConfig } from "./config-io.js";
import { resolveBlackholeConfigPath } from "./config-path.js";
import {
  isValidSessionId,
  readSessionPipeline,
  type GlobalConfigFields,
} from "./pipeline-reader.js";

/** Minimal structured logger surface (subset of PluginLogger). */
export interface RouteLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const ROUTE = "/api/plugins/blackhole/config";
const STATUS_ROUTE = "/api/plugins/blackhole/status";
const SESSION_ROUTE = "/api/plugins/blackhole/session/:id";
const EXTENSION_ID = "pi-blackhole";

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function compactionOrNull(v: unknown): GlobalConfigFields["compaction"] {
  return v === "auto" || v === "manual" || v === "off" ? v : null;
}

/** `provider/id` for a pinned ModelRef-shaped value; null otherwise. */
function modelKey(v: unknown): string | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const m = v as Record<string, unknown>;
  return typeof m.provider === "string" && typeof m.id === "string"
    ? `${m.provider}/${m.id}`
    : null;
}

/**
 * Mount the blackhole routes on a Fastify instance. Factored out of
 * `registerPlugin` so it can be exercised against an injected instance in
 * tests. `isPiExtensionInstalled` is the host's registry-backed capability
 * (optional — absent on older hosts / injected test contexts, where the
 * status route degrades to config-file existence, D1).
 */
export function registerBlackholeRoutes(
  fastify: FastifyInstance,
  deps: {
    logger: RouteLogger;
    env?: Record<string, string | undefined>;
    isPiExtensionInstalled?: (name: string) => Promise<boolean>;
  },
): void {
  const { logger, env } = deps;

  fastify.get(STATUS_ROUTE, async (_req, reply) => {
    if (deps.isPiExtensionInstalled) {
      // Capability present → the registry answer ALONE. Its negative is final:
      // config-file existence never overrides it (the file survives uninstall
      // and would hold the gate open forever). A rejection is a 503 — NEVER a
      // `{ installed: false }`, which the client would finalize into a
      // permanent false negative (X3).
      try {
        const installed = await deps.isPiExtensionInstalled(EXTENSION_ID);
        return { installed };
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        logger.warn(`blackhole installed-check failed reason=${reason}`);
        reply.code(503);
        return { error: "installed-check unavailable" };
      }
    }
    // Capability absent → degraded fallback: the config file is created by
    // the dashboard's PUT route, so existence means "configured here".
    return { installed: existsSync(resolveBlackholeConfigPath(env)) };
  });

  fastify.get<{ Params: { id: string } }>(SESSION_ROUTE, async (req, reply) => {
    const { id } = req.params;
    // Validate BEFORE any filesystem access (D5). The validator is pure; a
    // rejected id touches nothing.
    if (!isValidSessionId(id)) {
      reply.code(400);
      return { error: "invalid session id" };
    }
    // Global fields via the shared config reader. Parse failure degrades to
    // nulls — the session route never 409s on the global file (X6); the
    // settings surface owns that contract.
    const config = readConfig(resolveBlackholeConfigPath(env));
    const configOk = config.status === "ok" ? config : null;
    const fieldValue = (key: string) =>
      configOk ? configOk.fields[key]?.value : undefined;
    const configFields: GlobalConfigFields = {
      compactAfterTokens: numberOrNull(fieldValue("compactAfterTokens")),
      memory: boolOrNull(fieldValue("memory")),
      compaction: compactionOrNull(fieldValue("compaction")),
    };
    // Per-worker chain head: `<worker>Model ?? model`, as `provider/id`.
    const chainHead = (worker: string): string | null =>
      modelKey(fieldValue(`${worker}Model`)) ?? modelKey(fieldValue("model"));
    const state = readSessionPipeline(env, id, configFields, {
      observer: chainHead("observer"),
      reflector: chainHead("reflector"),
      dropper: chainHead("dropper"),
    });
    logger.info(
      `blackhole session pipeline read sessionId=${id} activity=${state.activity} pendingBatches=${state.pendingBatches}`,
    );
    return state;
  });

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
    // The write succeeded. If the file has ALREADY been corrupted again by
    // another process, the echo read comes back as a parse-error — do not spread
    // that into a 200 body, which would carry `status: "parse-error"` with no
    // fields and look like a failed save. Report the save on its own terms.
    const after = readConfig(filePath);
    if (after.status === "parse-error") {
      logger.warn(`blackhole config unparseable immediately after write path=${filePath}`);
      return { status: "ok" as const, filePath, staleEcho: true, ...saved };
    }
    return { ...after, ...saved };
  });
}

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("blackhole-plugin server entry activated");
  registerBlackholeRoutes(ctx.fastify, {
    logger: ctx.logger,
    isPiExtensionInstalled: ctx.isPiExtensionInstalled,
  });
}

export default registerPlugin;

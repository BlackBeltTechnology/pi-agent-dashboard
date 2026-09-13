/**
 * mcp-client-plugin · REST routes.
 *
 *   GET    /api/mcp-client/effective?cwd=      effective view (+ adapter verdict)
 *   GET    /api/mcp-client/schema              published config schema
 *   GET    /api/mcp-client/adapter[?fresh=1]   adapter version verdict
 *   PUT    /api/mcp-client/servers/:name       {scope, cwd?, set, unset?}
 *   DELETE /api/mcp-client/servers/:name?scope=&cwd=
 *   PUT    /api/mcp-client/servers/:name/disabled  {scope, cwd?, disabled}
 *   PUT    /api/mcp-client/settings            {set, unset?}
 *
 * Every route (GET included) is registered behind the host `networkGuard`:
 * mutating bodies become executable config for pi, and the effective view
 * returns own-layer credentials.
 * See change: extract-mcp-client-plugin (design D7).
 */

import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { isAllowedCwd } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AdapterTimeoutError } from "../core/adapter-worker.js";
import { isValidServerName } from "../core/config-writer.js";
import { mcpConfigSchema, validateServerPatch, validateSettingsPatch } from "../core/schema-validation.js";
import type { McpClientRuntime } from "../core/service.js";
import type { ConfigRefusal, Scope, ServerEntry } from "../core/types.js";

export interface McpClientRouteDeps {
  runtime: McpClientRuntime;
  knownCwds: () => string[];
  networkGuard: ServerPluginContext["networkGuard"];
  /** Reads `adapterLoadTimeoutMs` per request from the plugin namespace. */
  getTimeoutMs: () => number;
}

const PREFIX = "/api/mcp-client";

function sendRefusal(reply: FastifyReply, refusal: ConfigRefusal): FastifyReply {
  switch (refusal.code) {
    case "invalid-name":
      return reply.code(400).send({ error: refusal.code, message: refusal.message });
    case "transport-conflict":
    case "missing-transport":
      return reply.code(400).send({ error: refusal.code, message: refusal.message, fields: refusal.fields ?? [] });
    case "not-allowed":
      return reply.code(403).send({ error: refusal.code, message: refusal.message });
    case "unparseable":
    case "entry-not-object":
      return reply.code(409).send({ error: refusal.code, message: refusal.message });
    default:
      return reply.code(500).send({ error: refusal.code, message: refusal.message });
  }
}

interface ScopeBody {
  scope?: unknown;
  cwd?: unknown;
}

function parseScope(body: ScopeBody): { ok: true; scope: Scope } | { ok: false; error: string; status: number } {
  const kind = body.scope;
  if (kind === "global") return { ok: true, scope: { kind: "global" } };
  if (kind === "project") {
    if (typeof body.cwd !== "string" || body.cwd.length === 0) {
      return { ok: false, error: "project scope requires a cwd", status: 400 };
    }
    return { ok: true, scope: { kind: "project", cwd: body.cwd } };
  }
  return { ok: false, error: "scope must be 'global' or 'project'", status: 400 };
}

function decodeName(request: FastifyRequest): string {
  const raw = (request.params as { name?: string }).name ?? "";
  // Fastify already decodes params; decode defensively for double-encoded input.
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function mountMcpClientRoutes(fastify: FastifyInstance, deps: McpClientRouteDeps): void {
  const guard = { preHandler: deps.networkGuard };

  fastify.get(`${PREFIX}/effective`, guard, async (request, reply) => {
    const cwd = (request.query as { cwd?: string }).cwd;
    if (cwd !== undefined && !isAllowedCwd(cwd, deps.knownCwds)) {
      return reply.code(403).send({ error: "not-allowed", message: `cwd not allowed: ${cwd}` });
    }
    const scope: Scope = cwd ? { kind: "project", cwd } : { kind: "global" };
    try {
      const view = await deps.runtime.getEffectiveView(scope, { timeoutMs: deps.getTimeoutMs() });
      return { ...view, adapter: deps.runtime.adapterVerdict() };
    } catch (e) {
      if (e instanceof AdapterTimeoutError) {
        return reply.code(504).send({ error: "adapter-timeout", timeoutMs: e.timeoutMs });
      }
      return reply.code(500).send({ error: "adapter-error", message: (e as Error).message });
    }
  });

  fastify.get(`${PREFIX}/schema`, guard, async () => mcpConfigSchema);

  fastify.get(`${PREFIX}/adapter`, guard, async (request) => {
    const fresh = (request.query as { fresh?: string }).fresh === "1";
    return deps.runtime.adapterVerdict({ fresh });
  });

  fastify.put(`${PREFIX}/servers/:name`, guard, async (request, reply) => {
    const name = decodeName(request);
    if (!isValidServerName(name)) return reply.code(400).send({ error: "invalid-name", message: `invalid server name` });
    const body = (request.body ?? {}) as ScopeBody & { set?: unknown; unset?: unknown };
    if (body.set === undefined || typeof body.set !== "object" || Array.isArray(body.set)) {
      return reply.code(400).send({ error: "invalid-body", message: "body must carry a `set` patch object" });
    }
    const parsed = parseScope(body);
    if (!parsed.ok) return reply.code(parsed.status).send({ error: "invalid-body", message: parsed.error });
    const validation = validateServerPatch(body.set);
    if (!validation.ok) {
      return reply.code(400).send({ error: "schema", message: "server patch failed validation", fields: validationErrors(validation.errors) });
    }
    const unset = Array.isArray(body.unset) ? body.unset.filter((k): k is string => typeof k === "string") : [];
    const set = { ...(body.set as Record<string, unknown>) };
    const result = deps.runtime.applyServerPatch(name, set as Partial<ServerEntry>, unset, parsed.scope);
    if (!result.ok) return sendRefusal(reply, result.refusal);
    return { ok: true };
  });

  fastify.delete(`${PREFIX}/servers/:name`, guard, async (request, reply) => {
    const name = decodeName(request);
    if (!isValidServerName(name)) return reply.code(400).send({ error: "invalid-name", message: `invalid server name` });
    const query = request.query as { scope?: string; cwd?: string };
    const parsed = parseScope({ scope: query.scope ?? "global", cwd: query.cwd });
    if (!parsed.ok) return reply.code(parsed.status).send({ error: "invalid-body", message: parsed.error });
    const result = deps.runtime.removeServer(name, parsed.scope);
    if (!result.ok) return sendRefusal(reply, result.refusal);
    return { ok: true, removed: result.removed };
  });

  fastify.put(`${PREFIX}/servers/:name/disabled`, guard, async (request, reply) => {
    const name = decodeName(request);
    if (!isValidServerName(name)) return reply.code(400).send({ error: "invalid-name", message: `invalid server name` });
    const body = (request.body ?? {}) as ScopeBody & { disabled?: unknown };
    if (typeof body.disabled !== "boolean") {
      return reply.code(400).send({ error: "invalid-body", message: "`disabled` must be a boolean" });
    }
    const parsed = parseScope(body);
    if (!parsed.ok) return reply.code(parsed.status).send({ error: "invalid-body", message: parsed.error });
    try {
      const result = await deps.runtime.setServerDisabled(name, body.disabled, parsed.scope, {
        timeoutMs: deps.getTimeoutMs(),
      });
      if (!result.ok) return sendRefusal(reply, result.refusal);
      return { ok: true };
    } catch (e) {
      if (e instanceof AdapterTimeoutError) {
        return reply.code(504).send({ error: "adapter-timeout", timeoutMs: e.timeoutMs });
      }
      throw e;
    }
  });

  fastify.put(`${PREFIX}/settings`, guard, async (request, reply) => {
    const body = (request.body ?? {}) as { set?: unknown; unset?: unknown };
    if (body.set === undefined || typeof body.set !== "object" || Array.isArray(body.set)) {
      return reply.code(400).send({ error: "invalid-body", message: "body must carry a `set` patch object" });
    }
    const validation = validateSettingsPatch(body.set);
    if (!validation.ok) {
      return reply.code(400).send({ error: "schema", message: "settings patch failed validation", fields: validationErrors(validation.errors) });
    }
    const unset = Array.isArray(body.unset) ? body.unset.filter((k): k is string => typeof k === "string") : [];
    const result = deps.runtime.patchSettings(body.set as never, unset);
    if (!result.ok) return sendRefusal(reply, result.refusal);
    return { ok: true };
  });
}

function validationErrors(errors: Array<{ instancePath: string }>): string[] {
  return errors.map((e) => e.instancePath.replace(/^\//, "").split("/")[0]).filter((f) => f.length > 0);
}

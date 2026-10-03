/**
 * mcp-client-plugin · REST routes over pi's built-in MCP config.
 *
 *   GET    /api/mcp-client/effective?cwd=         effective view (files only, fast)
 *   GET    /api/mcp-client/live?cwd=&fresh=1      live state from `pi mcp list --json`
 *   GET    /api/mcp-client/schema                 published entry schema
 *   PUT    /api/mcp-client/servers/:name          {scope, cwd?, entry, previousName?} — whole-entry save
 *   DELETE /api/mcp-client/servers/:name?scope=&cwd=   → {ok, removed}
 *   PUT    /api/mcp-client/servers/:name/enabled  {scope, cwd?, enabled}
 *   POST   /api/mcp-client/servers/:name/convert  {scope, cwd?} — adapter leftovers → pi
 *
 * Every route (GET included) is registered behind the host `networkGuard`
 * (cookie/token/loopback auth): a write becomes executable configuration for
 * pi and the effective view returns own-layer credentials. Path names are
 * decoded and validated, and a project cwd is admitted against the
 * known-folder set, BEFORE any file is read or written.
 *
 * See change: migrate-mcp-to-pi-builtin (D3); earlier: extract-mcp-client-plugin (D7).
 */

import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { isAllowedCwd } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isValidServerName } from "../core/pi-rules.js";
import { errorFields, mcpConfigSchema, validateServerEntry } from "../core/schema-validation.js";
import type { McpClientRuntime } from "../core/service.js";
import type { ConfigRefusal, Scope, ServerEntry } from "../core/types.js";

export interface McpClientRouteDeps {
  runtime: McpClientRuntime;
  knownCwds: () => string[];
  networkGuard: ServerPluginContext["networkGuard"];
}

const PREFIX = "/api/mcp-client";

/**
 * Additive remedy fields on a cwd-allowlist refusal. The known-cwd set already
 * includes pinned directories, so pinning the refused directory is the remedy.
 * See change: add-access-grants-and-review.
 */
const CWD_DENIED_REASON = "cwd is not a known session or pinned directory.";
const CWD_DENIED_HINT = "Pin this directory to allow it, or open a session rooted in it.";

function notAllowed(cwd: string): { status: number; body: Record<string, unknown> } {
  return {
    status: 403,
    body: { error: "not-allowed", message: `cwd not allowed: ${cwd}`, reason: CWD_DENIED_REASON, hint: CWD_DENIED_HINT },
  };
}

function refusalParts(refusal: ConfigRefusal): { status: number; body: Record<string, unknown> } {
  const body: Record<string, unknown> = { error: refusal.code, message: refusal.message };
  switch (refusal.code) {
    case "invalid-name":
    case "invalid-entry":
      return { status: 400, body };
    case "transport-conflict":
      return { status: 400, body: { ...body, fields: refusal.fields ?? [] } };
    case "name-collision":
      return { status: 409, body: { ...body, ...(refusal.conflict ? { conflict: refusal.conflict } : {}) } };
    case "unparseable":
    case "entry-not-object":
      return { status: 409, body };
    default:
      return { status: 500, body: { ...body, ...(refusal.ioCode ? { ioCode: refusal.ioCode } : {}) } };
  }
}

function sendRefusal(reply: FastifyReply, refusal: ConfigRefusal): FastifyReply {
  const { status, body } = refusalParts(refusal);
  return reply.code(status).send(body);
}

interface ScopeInput {
  scope?: unknown;
  cwd?: unknown;
}

type ParsedScope = { ok: true; scope: Scope } | { ok: false; status: number; body: Record<string, unknown> };

/** Parse + ADMIT a scope (no IO): a project cwd must be a known folder. */
function parseScope(input: ScopeInput, knownCwds: () => string[]): ParsedScope {
  if (input.scope === "global") return { ok: true, scope: { kind: "global" } };
  if (input.scope === "project") {
    if (typeof input.cwd !== "string" || input.cwd.length === 0) {
      return { ok: false, status: 400, body: { error: "invalid-body", message: "project scope requires a cwd" } };
    }
    if (!isAllowedCwd(input.cwd, knownCwds)) return { ok: false, ...notAllowed(input.cwd) };
    return { ok: true, scope: { kind: "project", cwd: input.cwd } };
  }
  return { ok: false, status: 400, body: { error: "invalid-body", message: "scope must be 'global' or 'project'" } };
}

/** Decoded + validated path name, or null. */
function pathName(request: FastifyRequest): string | null {
  const raw = (request.params as { name?: string }).name ?? "";
  let name = raw;
  try {
    // Fastify already decodes params; decode defensively for double-encoded input.
    name = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return isValidServerName(name) ? name : null;
}

/** `?cwd=` → scope, admitted; a repeated key (array) is refused. */
function queryScope(request: FastifyRequest, knownCwds: () => string[]): ParsedScope {
  const rawCwd = (request.query as { cwd?: unknown }).cwd;
  if (rawCwd !== undefined && typeof rawCwd !== "string") {
    return { ok: false, status: 400, body: { error: "invalid-cwd", message: "cwd must be a single string" } };
  }
  if (rawCwd === undefined || rawCwd === "") return { ok: true, scope: { kind: "global" } };
  return parseScope({ scope: "project", cwd: rawCwd }, knownCwds);
}

const INVALID_NAME = { error: "invalid-name", message: "invalid server name" };

export function mountMcpClientRoutes(fastify: FastifyInstance, deps: McpClientRouteDeps): void {
  const guard = { preHandler: deps.networkGuard };
  const { runtime, knownCwds } = deps;

  fastify.get(`${PREFIX}/effective`, guard, async (request, reply) => {
    const parsed = queryScope(request, knownCwds);
    if (!parsed.ok) return reply.code(parsed.status).send(parsed.body);
    return runtime.getEffectiveView(parsed.scope);
  });

  fastify.get(`${PREFIX}/live`, guard, async (request, reply) => {
    const parsed = queryScope(request, knownCwds);
    if (!parsed.ok) return reply.code(parsed.status).send(parsed.body);
    const fresh = (request.query as { fresh?: string }).fresh === "1";
    return runtime.getLiveState(parsed.scope, { fresh });
  });

  fastify.get(`${PREFIX}/schema`, guard, async () => mcpConfigSchema);

  fastify.put(`${PREFIX}/servers/:name`, guard, async (request, reply) => {
    const name = pathName(request);
    if (!name) return reply.code(400).send(INVALID_NAME);
    const body = (request.body ?? {}) as ScopeInput & { entry?: unknown; previousName?: unknown };
    const parsed = parseScope(body, knownCwds);
    if (!parsed.ok) return reply.code(parsed.status).send(parsed.body);
    if (typeof body.entry !== "object" || body.entry === null || Array.isArray(body.entry)) {
      return reply.code(400).send({ error: "invalid-body", message: "body must carry an `entry` object" });
    }
    if (body.previousName !== undefined && (typeof body.previousName !== "string" || !isValidServerName(body.previousName))) {
      return reply.code(400).send(INVALID_NAME);
    }
    const validation = validateServerEntry(body.entry);
    if (!validation.ok) {
      return reply
        .code(400)
        .send({ error: "schema", message: "server entry failed validation", fields: errorFields(validation.errors) });
    }
    const result = runtime.saveServer(name, body.entry as ServerEntry, parsed.scope, {
      ...(typeof body.previousName === "string" ? { previousName: body.previousName } : {}),
    });
    if (!result.ok) return sendRefusal(reply, result.refusal);
    return { ok: true };
  });

  fastify.delete(`${PREFIX}/servers/:name`, guard, async (request, reply) => {
    const name = pathName(request);
    if (!name) return reply.code(400).send(INVALID_NAME);
    const query = request.query as { scope?: unknown; cwd?: unknown };
    const parsed = parseScope({ scope: query.scope ?? "global", cwd: query.cwd }, knownCwds);
    if (!parsed.ok) return reply.code(parsed.status).send(parsed.body);
    const result = runtime.removeServer(name, parsed.scope);
    if (!result.ok) return sendRefusal(reply, result.refusal);
    return { ok: true, removed: result.removed };
  });

  fastify.put(`${PREFIX}/servers/:name/enabled`, guard, async (request, reply) => {
    const name = pathName(request);
    if (!name) return reply.code(400).send(INVALID_NAME);
    const body = (request.body ?? {}) as ScopeInput & { enabled?: unknown };
    const parsed = parseScope(body, knownCwds);
    if (!parsed.ok) return reply.code(parsed.status).send(parsed.body);
    if (typeof body.enabled !== "boolean") {
      return reply.code(400).send({ error: "invalid-body", message: "`enabled` must be a boolean" });
    }
    const result = runtime.setEnabled(name, body.enabled, parsed.scope);
    if (!result.ok) return sendRefusal(reply, result.refusal);
    return result;
  });

  fastify.post(`${PREFIX}/servers/:name/convert`, guard, async (request, reply) => {
    const name = pathName(request);
    if (!name) return reply.code(400).send(INVALID_NAME);
    const parsed = parseScope((request.body ?? {}) as ScopeInput, knownCwds);
    if (!parsed.ok) return reply.code(parsed.status).send(parsed.body);
    const result = runtime.convertAdapterLeftovers(name, parsed.scope);
    if (!result.ok) return sendRefusal(reply, result.refusal);
    return { ok: true };
  });
}

/**
 * mcp-client-plugin · REST routes over pi's built-in MCP config.
 *
 *   GET    /api/mcp-client/effective?cwd=         effective view (files only, fast)
 *   GET    /api/mcp-client/live?cwd=&fresh=1      live state from `pi mcp list --json`
 *   GET    /api/mcp-client/schema                 published entry schema
 *   PUT    /api/mcp-client/servers/:name          {scope, cwd?, entry, previousName?, create?} — whole-entry save
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

import type { CwdHoldOrigin, ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import {
  type AdmitCwdOptions,
  admissionAllows,
  admitCwd,
  issueHeldAdmission,
  releaseAdmission,
} from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isValidServerName } from "../core/pi-rules.js";
import { errorFields, mcpConfigSchema, validateServerEntry } from "../core/schema-validation.js";
import type { McpClientRuntime } from "../core/service.js";
import type { ConfigRefusal, Scope, ServerEntry } from "../core/types.js";

export interface McpClientRouteDeps {
  runtime: McpClientRuntime;
  knownCwds: () => string[];
  networkGuard: ServerPluginContext["networkGuard"];
  /**
   * Host seam that raises the `cwd` access dialog. Optional: on a host without it
   * a write on an unknown cwd is refused with the existing 403.
   */
  holdCwdDenial?: ServerPluginContext["holdCwdDenial"];
  /** `admitCwd` options (the host's `onIndeterminate` logger; test seams). */
  admitOptions?: AdmitCwdOptions;
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

type ParsedScope =
  | { ok: true; scope: Scope }
  | { ok: false; status: number; body: Record<string, unknown>; headers?: Record<string, string> };

/** The decision could not be made (a git probe failed): transient, never a refusal. */
function admissionUnavailable(cwd: string): Extract<ParsedScope, { ok: false }> {
  return {
    ok: false,
    status: 503,
    body: {
      error: "cwd-admission-unavailable",
      message: `cwd admission could not be decided right now: ${cwd}`,
      retryAfterMs: 1000,
    },
    headers: { "Retry-After": "1" },
  };
}

function sendParseFailure(reply: FastifyReply, parsed: Extract<ParsedScope, { ok: false }>): FastifyReply {
  if (parsed.headers) reply.headers(parsed.headers);
  return reply.code(parsed.status).send(parsed.body);
}

/** End a route-built scope's admission token. Call in the handler's `finally`. */
function releaseScope(scope: Scope): void {
  if (scope.kind === "project" && scope.admission) releaseAdmission(scope.admission);
}

interface ScopeRequest {
  request: FastifyRequest;
  reply: FastifyReply;
  /** Set only on a user-initiated WRITE route: a refusal may raise the access dialog. */
  holdOrigin?: CwdHoldOrigin;
}

/** Ask the host to raise the access dialog for a refused write, and admit on a confirmed allow. */
async function admitViaHold(
  cwd: string,
  deps: McpClientRouteDeps,
  req: ScopeRequest & { holdOrigin: CwdHoldOrigin },
): Promise<ParsedScope | null> {
  if (!deps.holdCwdDenial) return null;
  const decision = await deps.holdCwdDenial(req.request, req.reply, { cwd, origin: req.holdOrigin });
  if (decision.kind === "indeterminate") return admissionUnavailable(cwd);
  // The host returns a decision, never a token: mint our own, bound to this cwd.
  const held = await issueHeldAdmission(decision, cwd);
  if (held.kind === "admit" && admissionAllows(held, cwd)) {
    return { ok: true, scope: { kind: "project", cwd, admission: held.token } };
  }
  return held.kind === "indeterminate" ? admissionUnavailable(cwd) : null;
}

/** Admit a project `cwd`: `admit` → token-bearing scope; `indeterminate` → 503; `refuse` → hold (writes) or 403. */
async function admitProject(cwd: string, deps: McpClientRouteDeps, req: ScopeRequest): Promise<ParsedScope> {
  const admission = await admitCwd(cwd, deps.knownCwds, deps.admitOptions);
  if (admission.kind === "admit" && admissionAllows(admission, cwd)) {
    return { ok: true, scope: { kind: "project", cwd, admission: admission.token } };
  }
  if (admission.kind === "indeterminate") return admissionUnavailable(cwd);
  if (req.holdOrigin) {
    const held = await admitViaHold(cwd, deps, { ...req, holdOrigin: req.holdOrigin });
    if (held) return held;
  }
  return { ok: false, ...notAllowed(cwd) };
}

/**
 * Parse + ADMIT a scope before any IO. A project cwd is decided by the async
 * tri-state guard: `admit` → a scope carrying a request-scoped token; `refuse` →
 * on a write route the host may ask the operator (`holdCwdDenial`), else 403;
 * `indeterminate` → 503 (never a refusal, never a prompt). A client-sent
 * `admission` field is never read.
 */
async function parseScope(input: ScopeInput, deps: McpClientRouteDeps, req: ScopeRequest): Promise<ParsedScope> {
  if (input.scope === "global") return { ok: true, scope: { kind: "global" } };
  if (input.scope !== "project") {
    return { ok: false, status: 400, body: { error: "invalid-body", message: "scope must be 'global' or 'project'" } };
  }
  const cwd = input.cwd;
  if (typeof cwd !== "string" || cwd.length === 0) {
    return { ok: false, status: 400, body: { error: "invalid-body", message: "project scope requires a cwd" } };
  }
  return admitProject(cwd, deps, req);
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
async function queryScope(request: FastifyRequest, reply: FastifyReply, deps: McpClientRouteDeps): Promise<ParsedScope> {
  const rawCwd = (request.query as { cwd?: unknown }).cwd;
  if (rawCwd !== undefined && typeof rawCwd !== "string") {
    return { ok: false, status: 400, body: { error: "invalid-cwd", message: "cwd must be a single string" } };
  }
  if (rawCwd === undefined || rawCwd === "") return { ok: true, scope: { kind: "global" } };
  return parseScope({ scope: "project", cwd: rawCwd }, deps, { request, reply });
}

const INVALID_NAME = { error: "invalid-name", message: "invalid server name" };

export function mountMcpClientRoutes(fastify: FastifyInstance, deps: McpClientRouteDeps): void {
  const guard = { preHandler: deps.networkGuard };
  const { runtime } = deps;

  fastify.get(`${PREFIX}/effective`, guard, async (request, reply) => {
    const parsed = await queryScope(request, reply, deps);
    if (!parsed.ok) return sendParseFailure(reply, parsed);
    try {
      return runtime.getEffectiveView(parsed.scope);
    } finally {
      releaseScope(parsed.scope);
    }
  });

  fastify.get(`${PREFIX}/live`, guard, async (request, reply) => {
    const parsed = await queryScope(request, reply, deps);
    if (!parsed.ok) return sendParseFailure(reply, parsed);
    try {
      const fresh = (request.query as { fresh?: string }).fresh === "1";
      return await runtime.getLiveState(parsed.scope, { fresh });
    } finally {
      releaseScope(parsed.scope);
    }
  });

  fastify.get(`${PREFIX}/schema`, guard, async () => mcpConfigSchema);

  fastify.put(`${PREFIX}/servers/:name`, guard, async (request, reply) => {
    const name = pathName(request);
    if (!name) return reply.code(400).send(INVALID_NAME);
    const body = (request.body ?? {}) as ScopeInput & { entry?: unknown; previousName?: unknown; create?: unknown };
    // Cheap body validation first, so an invalid body never raises an access dialog.
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
    const parsed = await parseScope(body, deps, { request, reply, holdOrigin: "mcp:save" });
    if (!parsed.ok) return sendParseFailure(reply, parsed);
    try {
      const result = runtime.saveServer(name, body.entry as ServerEntry, parsed.scope, {
        ...(typeof body.previousName === "string" ? { previousName: body.previousName } : {}),
        ...(body.create === true ? { create: true } : {}),
      });
      if (!result.ok) return sendRefusal(reply, result.refusal);
      return { ok: true };
    } finally {
      releaseScope(parsed.scope);
    }
  });

  fastify.delete(`${PREFIX}/servers/:name`, guard, async (request, reply) => {
    const name = pathName(request);
    if (!name) return reply.code(400).send(INVALID_NAME);
    const query = request.query as { scope?: unknown; cwd?: unknown };
    const parsed = await parseScope({ scope: query.scope ?? "global", cwd: query.cwd }, deps, {
      request,
      reply,
      holdOrigin: "mcp:delete",
    });
    if (!parsed.ok) return sendParseFailure(reply, parsed);
    try {
      const result = runtime.removeServer(name, parsed.scope);
      if (!result.ok) return sendRefusal(reply, result.refusal);
      return { ok: true, removed: result.removed };
    } finally {
      releaseScope(parsed.scope);
    }
  });

  fastify.put(`${PREFIX}/servers/:name/enabled`, guard, async (request, reply) => {
    const name = pathName(request);
    if (!name) return reply.code(400).send(INVALID_NAME);
    const body = (request.body ?? {}) as ScopeInput & { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return reply.code(400).send({ error: "invalid-body", message: "`enabled` must be a boolean" });
    }
    const parsed = await parseScope(body, deps, { request, reply, holdOrigin: "mcp:enable" });
    if (!parsed.ok) return sendParseFailure(reply, parsed);
    try {
      const result = runtime.setEnabled(name, body.enabled, parsed.scope);
      if (!result.ok) return sendRefusal(reply, result.refusal);
      return result;
    } finally {
      releaseScope(parsed.scope);
    }
  });

  fastify.post(`${PREFIX}/servers/:name/convert`, guard, async (request, reply) => {
    const name = pathName(request);
    if (!name) return reply.code(400).send(INVALID_NAME);
    const parsed = await parseScope((request.body ?? {}) as ScopeInput, deps, {
      request,
      reply,
      holdOrigin: "mcp:convert",
    });
    if (!parsed.ok) return sendParseFailure(reply, parsed);
    try {
      const result = runtime.convertAdapterLeftovers(name, parsed.scope);
      if (!result.ok) return sendRefusal(reply, result.refusal);
      return { ok: true };
    } finally {
      releaseScope(parsed.scope);
    }
  });
}

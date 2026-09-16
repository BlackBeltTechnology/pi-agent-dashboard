/**
 * Stateful-at-the-edge, stateless underneath: dispatch for the dual-era MCP
 * endpoint.
 *
 * "Stateless" here is precise: no request may depend on state established by a
 * previous request. There is no session id the server records, no resume token
 * and no `Last-Event-ID` — so every request is self-describing and
 * independently servable (E8, E18, X7).
 *
 * The protocol era is resolved ONCE in `routes.ts` (single resolution site,
 * D1) and passed in as `resolved`; this module never re-resolves. The
 * legacy-only surface (`initialize`, `notifications/*`, `ping`) is a thin
 * adapter in front of the same per-method dispatcher the modern era uses.
 * `Mcp-Session-Id` is minted only so clients that store and echo it are happy
 * — it is never recorded and never checked (D2).
 *
 * A `subscriptions/listen` stream does not violate statelessness. Its
 * subscription is scoped to the lifetime of the single request that opened it
 * and dies with that request; nothing is shared *between* requests.
 */

import crypto from "node:crypto";
import type { Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { rank } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { evaluateSelfTarget } from "./guard.js";
import {
  RPC_INSUFFICIENT_SCOPE,
  RPC_INVALID_PARAMS,
  RPC_METHOD_NOT_FOUND,
  type RpcHttpResponse,
  type RpcId,
  type RpcRequest,
  rpcError,
  rpcResult,
} from "./jsonrpc.js";
import {
  MODERN_PROTOCOL_VERSION,
  type ProtocolEra,
  type ProtocolVersionFailure,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "./protocol.js";
import type { McpCaller } from "./tokens.js";

export type { McpCaller };
import { GENERATED_TOOLS, type GeneratedTool } from "./generated/tools.js";
import { findTool, listTools } from "./tools.js";

/** Methods reported as unsupported rather than silently accepted (modern era). */
export const REMOVED_METHODS = [
  // SEP-2575 removed the handshake. Accepting it silently would let a legacy
  // client believe it negotiated something (E9).
  "initialize",
  "notifications/initialized",
  // Replaced by subscriptions/listen (S7).
  "resources/subscribe",
  "resources/unsubscribe",
] as const;

/** How a version failure maps onto the wire. Used by `routes.ts`, the single
 * resolution site, so the failure→status pairing has one owner. */
const VERSION_FAILURES: Record<
  ProtocolVersionFailure,
  { status: number; message: string; type: string }
> = {
  AmbiguousHeader: {
    status: 400,
    message: "MCP-Protocol-Version header was sent more than once",
    type: "AmbiguousHeader",
  },
  MissingHeader: {
    status: 400,
    message: "MCP-Protocol-Version header is required on every request",
    type: "MissingProtocolVersionHeader",
  },
  MissingMeta: {
    status: 400,
    message: "params._meta must declare io.modelcontextprotocol/protocolVersion",
    type: "MissingProtocolVersion",
  },
  HeaderMismatch: {
    status: 400,
    message: "MCP-Protocol-Version header disagrees with params._meta",
    type: "HeaderMismatch",
  },
  UnsupportedProtocolVersion: {
    status: 400,
    message: `Unsupported protocol version. Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`,
    type: "UnsupportedProtocolVersionError",
  },
};

/** Map a version-resolution failure onto the wire (E4/E12, X3). */
export function versionFailureResponse(
  code: ProtocolVersionFailure,
  id: RpcId,
): RpcHttpResponse {
  const f = VERSION_FAILURES[code];
  return rpcError(f.status, id, RPC_INVALID_PARAMS, f.message, f.type);
}

/** Everything a tool handler needs. Handlers never see the raw request. */
export interface ToolInvocation {
  tool: GeneratedTool;
  args: Record<string, unknown>;
  caller: McpCaller;
}

/** Options for the REST binder's `fastify.inject` call (design D4). */
export interface InjectOptions {
  method: string;
  url: string;
  payload?: unknown;
  headers?: Record<string, string>;
  remoteAddress?: string;
}

/** The subset of a Fastify inject reply the binder needs. */
export interface InjectResult {
  statusCode: number;
  body: unknown;
}

/** Per-request transport context the route hands down (headers, peer IP). */
export interface DispatchContext {
  /** The originating `/mcp` request headers. */
  headers?: Record<string, unknown>;
  /** The originating peer address (Fastify's `request.ip`). */
  remoteAddress?: string;
}

export interface DispatchDeps {
  /**
   * Execute a `context`-bound tool (the four original tools). Kept as one hook
   * so the plugin entry owns the `ServerPluginContext` mapping.
   */
  invokeTool(invocation: ToolInvocation): Promise<unknown>;
  /** Run a `rest`-bound tool through `fastify.inject` with caller identity. */
  inject?(options: InjectOptions): Promise<InjectResult>;
  /** Forward a `session`-bound tool to the owning bridge. */
  sendToSession?(sessionId: string, message: Record<string, unknown>): boolean;
  /** Dashboard identity for `server/discover`. */
  serverInfo: { name: string; version: string };
  /** Record a refused self-target (G5). */
  recordRefusal?(detail: { callerSessionId: string; targetSessionId: string; tool: string }): void;
  /** Record an out-of-tier refusal (change: expand-mcp-tiered-surface, D2). */
  recordTierRefusal?(detail: {
    caller: McpCaller;
    tool: string;
    callerTier: Tier;
    requiredTier: Tier;
  }): void;
  /**
   * The advertised tool set. Defaults to `GENERATED_TOOLS`; injectable so a
   * fixture can exercise the tier filter and binders without the full manifest.
   */
  tools?: readonly GeneratedTool[];
  /** Open a subscription stream. Absent in unit contexts that never call it. */
  openSubscription?(sessionIds: string[], caller: McpCaller): Promise<unknown>;
  /** Whether the streaming transport is wired; drives `server/discover`. */
  streamingAvailable?: boolean;
}

/** The tool set for this dispatch, defaulting to the generated manifest. */
function toolsFor(deps: DispatchDeps): readonly GeneratedTool[] {
  return deps.tools ?? GENERATED_TOOLS;
}

/**
 * The spec-shaped out-of-tier refusal: HTTP 403 + the `insufficient_scope`
 * scope challenge header + a JSON-RPC error naming the required tier (D2).
 */
export function tierRefusalResponse(id: RpcId, scope: Tier): RpcHttpResponse {
  return {
    status: 403,
    wwwAuthenticate: `Bearer error="insufficient_scope", scope="${scope}"`,
    body: {
      jsonrpc: "2.0",
      id,
      error: {
        code: RPC_INSUFFICIENT_SCOPE,
        message: "insufficient_scope",
        data: { scope, type: "InsufficientScope" },
      },
    },
  };
}

function argsOf(params: unknown): Record<string, unknown> {
  if (typeof params !== "object" || params === null) return {};
  const args = (params as { arguments?: unknown }).arguments;
  return typeof args === "object" && args !== null && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

/**
 * `server/discover` — a MUST on this revision.
 *
 * Deliberately built fresh from constants on every call and reading nothing
 * mutable, so two connections receive equivalent responses and no server-side
 * state is created (E19, E20).
 */
export function buildDiscoverResult(
  serverInfo: { name: string; version: string },
  // Advertised from the ACTUAL wiring. Claiming `listen: true` for a method
  // that always errors is worse than claiming false: a client would build on a
  // capability that does not exist.
  streamingAvailable = true,
) {
  return {
    protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
    capabilities: {
      tools: { listChanged: false },
      subscriptions: { listen: streamingAvailable },
      // Stated explicitly rather than by omission: these are gone in this
      // revision, and a client should not have to infer that.
      resources: { subscribe: false },
    },
    serverInfo: { ...serverInfo },
  };
}

/**
 * Validate a `subscriptions/listen` filter (design.md Decision 9).
 *
 * Absent, empty, and non-array all fail. "Fan out every session" is not a
 * default we chose against — there is no input that expresses it, so S3's
 * dangerous partition is unreachable rather than merely unselected.
 */
export function parseSubscriptionFilter(
  params: unknown,
): { ok: true; sessionIds: string[] } | { ok: false; message: string } {
  const raw =
    typeof params === "object" && params !== null
      ? (params as { sessionIds?: unknown }).sessionIds
      : undefined;

  if (raw === undefined) {
    return { ok: false, message: "params.sessionIds is required — there is no subscribe-to-all" };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, message: "params.sessionIds must be an array of session ids" };
  }
  if (raw.length === 0) {
    return { ok: false, message: "params.sessionIds must name at least one session" };
  }
  if (!raw.every((s) => typeof s === "string" && s.length > 0)) {
    return { ok: false, message: "params.sessionIds must contain only non-empty strings" };
  }
  return { ok: true, sessionIds: raw as string[] };
}

/** The version verdict handed down by the single resolution site (`routes.ts`). */
export interface ResolvedVersion {
  era: ProtocolEra;
  version: string;
}

/** Opaque compatibility token: random 128-bit hex, minted once, never stored (D2). */
function mintSessionId(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Dispatch one already-parsed JSON-RPC request.
 *
 * @param resolved the protocol version resolved ONCE in `routes.ts` — this
 *   module never re-resolves (single resolution site, D1).
 * @param caller resolved from the presented credential by the auth layer —
 *   never from anything in `request` (M3).
 */
export async function dispatchRpc(
  request: RpcRequest,
  resolved: ResolvedVersion,
  caller: McpCaller,
  deps: DispatchDeps,
  ctx: DispatchContext = {},
): Promise<RpcHttpResponse> {
  const id: RpcId = request.id ?? null;
  const { era } = resolved;

  if (era === "legacy") {
    return dispatchLegacy(request, resolved, id, caller, deps, ctx);
  }

  if ((REMOVED_METHODS as readonly string[]).includes(request.method)) {
    return rpcError(
      404,
      id,
      RPC_METHOD_NOT_FOUND,
      `${request.method} is not supported on protocol revision ${MODERN_PROTOCOL_VERSION}`,
      "MethodRemoved",
    );
  }

  return dispatchModernRest(request, id, caller, deps, ctx);
}

async function dispatchModernRest(
  request: RpcRequest,
  id: RpcId,
  caller: McpCaller,
  deps: DispatchDeps,
  ctx: DispatchContext,
): Promise<RpcHttpResponse> {  switch (request.method) {
    case "server/discover":
      return rpcResult(
        id,
        buildDiscoverResult(deps.serverInfo, deps.streamingAvailable ?? deps.openSubscription !== undefined),
      );

    case "tools/list":
      return rpcResult(id, { tools: listTools(toolsFor(deps), caller.tier) });

    case "tools/call":
      return dispatchToolCall(request, id, caller, deps, ctx);

    case "subscriptions/listen": {
      const filter = parseSubscriptionFilter(request.params);
      if (!filter.ok) {
        return rpcError(400, id, RPC_INVALID_PARAMS, filter.message, "InvalidSubscriptionFilter");
      }
      if (!deps.openSubscription) {
        return rpcError(500, id, RPC_METHOD_NOT_FOUND, "Streaming is not wired up");
      }
      return rpcResult(id, await deps.openSubscription(filter.sessionIds, caller));
    }

    default:
      // 404 + -32601 is the revision's required pairing for an unknown method
      // (E15/E16). Notably NOT a fall-through to the SPA handler.
      return rpcError(404, id, RPC_METHOD_NOT_FOUND, `Unknown method: ${request.method}`);
  }
}

/**
 * The legacy-era surface (D1): the three 2025-era revisions get the
 * Streamable-HTTP compatibility adapter — handshake, notifications, ping —
 * with everything else flowing into the SAME per-method dispatcher as the
 * modern era, so the tool allowlist, guard and per-tool behaviour have no era
 * variant.
 */
function dispatchLegacy(
  request: RpcRequest,
  resolved: ResolvedVersion,
  id: RpcId,
  caller: McpCaller,
  deps: DispatchDeps,
  ctx: DispatchContext,
): Promise<RpcHttpResponse> | RpcHttpResponse {
  // Method prefix decides, BEFORE any other handling: a `notifications/*`
  // message is acted on by nobody, with or without a stray `id` (E6).
  if (request.method.startsWith("notifications/")) {
    return { status: 202, body: null };
  }

  switch (request.method) {
    case "initialize":
      // Static InitializeResult, per the 2025 ServerCapabilities schema —
      // deliberately NOT the discover object, whose `subscriptions`/`resources`
      // keys are foreign to the 2025 schema and would fail strict SDK
      // validation. `protocolVersion` was already negotiated by the resolver
      // (echoed, or negotiated down to `2025-11-25`).
      return {
        status: 200,
        sessionId: mintSessionId(),
        body: {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: resolved.version,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { ...deps.serverInfo },
          },
        },
      };

    case "ping":
      return rpcResult(id, {});

    case "subscriptions/listen":
      // Streaming stays modern-only (D3): no stream, the MethodRemoved shape.
      return rpcError(
        404,
        id,
        RPC_METHOD_NOT_FOUND,
        `subscriptions/listen is not supported on protocol revision ${resolved.version}`,
        "MethodRemoved",
      );

    default:
      break;
  }

  // Everything else — tools/list, tools/call, server/discover, unknown
  // methods — flows through the modern path unchanged.
  return dispatchModernRest(request, id, caller, deps, ctx);
}

async function dispatchToolCall(
  request: RpcRequest,
  id: RpcId,
  caller: McpCaller,
  deps: DispatchDeps,
  ctx: DispatchContext,
): Promise<RpcHttpResponse> {
  const name = typeof request.params === "object" && request.params !== null
    ? (request.params as { name?: unknown }).name
    : undefined;

  const tool = findTool(name, toolsFor(deps));
  if (!tool) {
    return rpcError(404, id, RPC_METHOD_NOT_FOUND, `Unknown tool: ${String(name)}`);
  }

  // Tier check FIRST (D2): an out-of-tier call is refused before argument
  // validation and before the self-target guard. The two refusals stay
  // distinguishable (scope challenge vs unknown tool), which is what lets a
  // client prompt for a higher-tier token.
  if (rank(tool.tier) > rank(caller.tier)) {
    deps.recordTierRefusal?.({
      caller,
      tool: tool.name,
      callerTier: caller.tier,
      requiredTier: tool.tier,
    });
    return tierRefusalResponse(id, tool.tier);
  }

  const args = argsOf(request.params);

  // Required arguments are checked before the guard so a malformed call is
  // reported as invalid-params rather than being masked by a refusal (E26).
  for (const required of tool.inputSchema.required ?? []) {
    if (typeof args[required] !== "string" || (args[required] as string).length === 0) {
      return rpcError(
        400,
        id,
        RPC_INVALID_PARAMS,
        `${tool.name} requires a non-empty "${required}" argument`,
      );
    }
  }

  if (tool.sessionTargeting) {
    const verdict = evaluateSelfTarget(caller, args.sessionId as string, tool.name);
    if (!verdict.allowed) {
      deps.recordRefusal?.({
        callerSessionId: verdict.callerSessionId,
        targetSessionId: verdict.targetSessionId,
        tool: verdict.tool,
      });
      return rpcError(
        403,
        id,
        RPC_INVALID_PARAMS,
        "A session may not drive itself through the MCP endpoint",
        "SelfTargetRefused",
      );
    }
  }

  try {
    return rpcResult(id, await executeTool(tool, args, caller, deps, ctx));
  } catch (err) {
    // A binder argument failure is invalid-params, never an internal error.
    if (err instanceof ToolArgumentError) {
      return rpcError(400, id, RPC_INVALID_PARAMS, err.message, "InvalidToolArguments");
    }
    throw err;
  }
}

// ── Transport binders (D3/D4) ──────────────────────────────────────────────

/** Characters that must never appear in a path-parameter value. */
const UNSAFE_PATH_CHARS = /[/?#%]/;

/**
 * Execute a tool through its declared binding. `context` rows call the plugin's
 * member handlers; `rest` rows run `fastify.inject` with the caller's identity;
 * `session` rows forward a bridge message.
 */
async function executeTool(
  tool: GeneratedTool,
  args: Record<string, unknown>,
  caller: McpCaller,
  deps: DispatchDeps,
  ctx: DispatchContext,
): Promise<unknown> {
  switch (tool.bind.kind) {
    case "context":
      return deps.invokeTool({ tool, args, caller });
    case "session":
      return executeSession(tool, args, deps);
    case "rest":
      return executeRest(tool, args, caller, deps, ctx);
  }
}

function executeSession(tool: GeneratedTool, args: Record<string, unknown>, deps: DispatchDeps) {
  if (tool.bind.kind !== "session") throw new Error("not a session-bound tool");
  const sessionId = args.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new ToolArgumentError('requires a non-empty "sessionId"');
  }
  const { sessionId: _sid, ...rest } = args;
  const delivered = deps.sendToSession?.(sessionId, {
    type: tool.bind.message,
    sessionId,
    ...rest,
  });
  return { delivered: delivered === true };
}

/** Argument-validation failure raised inside a binder (mapped to -32602). */
export class ToolArgumentError extends Error {}

async function executeRest(
  tool: GeneratedTool,
  args: Record<string, unknown>,
  caller: McpCaller,
  deps: DispatchDeps,
  ctx: DispatchContext,
): Promise<unknown> {
  if (tool.bind.kind !== "rest") throw new Error("not a rest-bound tool");
  if (!deps.inject) throw new Error(`no REST transport wired for ${tool.name}`);

  const split = tool.paramSplit;
  const pathArgNames = new Set(split.path.map((p) => p.arg));

  // Path parameters: string-only, and never a value that could smuggle an
  // extra path segment or query under the caller's credential (E20).
  let url = tool.bind.path;
  for (const { arg, param } of split.path) {
    const value = args[arg];
    if (typeof value !== "string" || value.length === 0) {
      throw new ToolArgumentError(`${tool.name} requires a non-empty "${arg}" path argument`);
    }
    if (UNSAFE_PATH_CHARS.test(value)) {
      throw new ToolArgumentError(`${arg} must not contain /, ?, # or %`);
    }
    url = url.replace(`:${param}`, encodeURIComponent(value));
  }

  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) if (!pathArgNames.has(k)) rest[k] = v;

  let payload: unknown;
  if (tool.bind.method === "GET") {
    const queryNames = split.queryAll ? Object.keys(rest) : (split.query ?? []);
    const params = new URLSearchParams();
    for (const name of queryNames) {
      const v = rest[name];
      if (v === undefined || v === null) continue;
      params.append(name, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  } else {
    const bodyNames = split.bodyAll ? Object.keys(rest) : (split.body ?? []);
    const body: Record<string, unknown> = { ...(tool.bind.fixed ?? {}) };
    for (const name of bodyNames) if (rest[name] !== undefined) body[name] = rest[name];
    payload = body;
  }

  const { headers, remoteAddress } = injectIdentity(caller, ctx);
  const options: InjectOptions = { method: tool.bind.method, url, headers, remoteAddress };
  if (tool.bind.method !== "GET") options.payload = payload;
  const res = await deps.inject(options);
  return mapRestEnvelope(tool.name, res);
}

/**
 * Caller identity for the injected request (D4). A device caller forwards its
 * own credential and the tunnel's forwarding headers so `bearer-auth`,
 * `isGenuinelyLocal` and the host gate see the real origin; a session caller
 * injects as loopback with no credential (the trust a local pi session already
 * holds). `origin` is never forwarded.
 */
function injectIdentity(
  caller: McpCaller,
  ctx: DispatchContext,
): { headers: Record<string, string>; remoteAddress: string } {
  const src = ctx.headers ?? {};
  const headers: Record<string, string> = {};
  const pick = (name: string) => {
    const v = src[name];
    if (typeof v === "string") headers[name] = v;
  };
  if (caller.kind === "device") {
    pick("host");
    pick("authorization");
    pick("x-forwarded-for");
    pick("x-forwarded-proto");
    pick("x-real-ip");
    return { headers, remoteAddress: ctx.remoteAddress ?? "127.0.0.1" };
  }
  pick("host");
  return { headers, remoteAddress: "127.0.0.1" };
}

/** Map the REST `{ success, data | error }` envelope onto an MCP tool result. */
function mapRestEnvelope(name: string, res: InjectResult): unknown {
  const body = res.body as { success?: boolean; data?: unknown; error?: unknown } | undefined;
  if (res.statusCode >= 400) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify(body ?? {}) }] };
  }
  if (body && body.success === false) {
    const message = typeof body.error === "string" ? body.error : `${name} failed`;
    return { isError: true, content: [{ type: "text", text: message }] };
  }
  const data = body && "data" in body ? body.data : body;
  return { content: [{ type: "text", text: JSON.stringify(data ?? null) }] };
}

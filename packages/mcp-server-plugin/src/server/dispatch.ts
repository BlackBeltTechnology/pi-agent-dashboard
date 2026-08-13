/**
 * Stateless JSON-RPC dispatch for MCP revision 2026-07-28.
 *
 * "Stateless" here is precise: no request may depend on state established by a
 * previous request. There is no `initialize` handshake to complete, no session
 * id to carry, and no `Last-Event-ID` to resume from — so every request is
 * self-describing and independently servable (E8, E18, X7).
 *
 * A `subscriptions/listen` stream does not violate this. Its subscription is
 * scoped to the lifetime of the single request that opened it and dies with
 * that request; nothing is shared *between* requests.
 */
import {
  RPC_INVALID_PARAMS,
  RPC_METHOD_NOT_FOUND,
  type RpcHttpResponse,
  type RpcId,
  type RpcRequest,
  rpcError,
  rpcResult,
} from "./jsonrpc.js";
import {
  CURRENT_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  type ProtocolVersionFailure,
  resolveProtocolVersion,
} from "./protocol.js";
import { type McpCaller } from "./tokens.js";
import { MCP_TOOLS, type McpToolDef, findTool, listTools } from "./tools.js";
import { evaluateSelfTarget } from "./guard.js";

/** Methods reported as unsupported rather than silently accepted. */
export const REMOVED_METHODS = [
  // SEP-2575 removed the handshake. Accepting it silently would let a legacy
  // client believe it negotiated something (E9).
  "initialize",
  "notifications/initialized",
  // Replaced by subscriptions/listen (S7).
  "resources/subscribe",
  "resources/unsubscribe",
] as const;

/** How a version failure maps onto the wire. */
const VERSION_FAILURES: Record<
  ProtocolVersionFailure,
  { status: number; message: string; type: string }
> = {
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

/** Everything a tool handler needs. Handlers never see the raw request. */
export interface ToolInvocation {
  tool: McpToolDef;
  args: Record<string, unknown>;
  caller: McpCaller;
}

export interface DispatchDeps {
  /** Invoke a tool. Rejections become `-32603`, never an unhandled rejection. */
  invokeTool(invocation: ToolInvocation): Promise<unknown>;
  /** Dashboard identity for `server/discover`. */
  serverInfo: { name: string; version: string };
  /** Record a refused self-target (G5). */
  recordRefusal?(detail: { callerSessionId: string; targetSessionId: string; tool: string }): void;
  /** Open a subscription stream. Absent in unit contexts that never call it. */
  openSubscription?(sessionIds: string[], caller: McpCaller): Promise<unknown>;
  /** Whether the streaming transport is wired; drives `server/discover`. */
  streamingAvailable?: boolean;
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

/**
 * Dispatch one already-parsed JSON-RPC request.
 *
 * @param caller resolved from the presented credential by the auth layer —
 *   never from anything in `request` (M3).
 */
export async function dispatchRpc(
  request: RpcRequest,
  headerVersion: string | string[] | undefined,
  caller: McpCaller,
  deps: DispatchDeps,
): Promise<RpcHttpResponse> {
  const id: RpcId = request.id ?? null;

  // Version is validated before the method is even looked at: an unsupported
  // client must not be able to reach a handler, and a version error is more
  // actionable than a downstream one.
  const version = resolveProtocolVersion(headerVersion, request.params);
  if (!version.ok) {
    const f = VERSION_FAILURES[version.code];
    return rpcError(f.status, id, RPC_INVALID_PARAMS, f.message, f.type);
  }

  if ((REMOVED_METHODS as readonly string[]).includes(request.method)) {
    return rpcError(
      404,
      id,
      RPC_METHOD_NOT_FOUND,
      `${request.method} is not supported on protocol revision ${CURRENT_PROTOCOL_VERSION}`,
      "MethodRemoved",
    );
  }

  switch (request.method) {
    case "server/discover":
      return rpcResult(
        id,
        buildDiscoverResult(deps.serverInfo, deps.streamingAvailable ?? deps.openSubscription !== undefined),
      );

    case "tools/list":
      return rpcResult(id, { tools: listTools(MCP_TOOLS) });

    case "tools/call":
      return dispatchToolCall(request, id, caller, deps);

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

async function dispatchToolCall(
  request: RpcRequest,
  id: RpcId,
  caller: McpCaller,
  deps: DispatchDeps,
): Promise<RpcHttpResponse> {
  const name = typeof request.params === "object" && request.params !== null
    ? (request.params as { name?: unknown }).name
    : undefined;

  const tool = findTool(name);
  if (!tool) {
    return rpcError(404, id, RPC_METHOD_NOT_FOUND, `Unknown tool: ${String(name)}`);
  }

  const args = argsOf(request.params);

  // Required arguments are checked before the guard so a malformed call is
  // reported as invalid-params rather than being masked by a refusal (E26).
  for (const required of tool.inputSchema.required) {
    if (typeof args[required] !== "string" || (args[required] as string).length === 0) {
      return rpcError(
        400,
        id,
        RPC_INVALID_PARAMS,
        `${tool.name} requires a non-empty "${required}" argument`,
      );
    }
  }

  if (tool.targetsSession) {
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

  return rpcResult(id, await deps.invokeTool({ tool, args, caller }));
}

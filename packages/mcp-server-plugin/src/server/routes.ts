/**
 * Fastify route registration for `/mcp`.
 *
 * The 405 requirement needs EXPLICIT handlers, and this is the subtlest part of
 * the change. Fastify's router falls an unmatched method through to
 * `setNotFoundHandler` (`packages/server/src/server.ts`), which in `--dev`
 * proxies to Vite and returns **200 with SPA HTML**. That is a conformance
 * failure that looks like success: a client asking for the MCP endpoint gets a
 * web page and a 200. Registering every non-POST method explicitly is what
 * keeps E1-E4 honest in both modes.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticate, type AuthDeps } from "./auth.js";
import {
  RPC_INTERNAL_ERROR,
  RPC_PARSE_ERROR,
  type RpcHttpResponse,
  extractId,
  parseRpcRequest,
  rpcError,
} from "./jsonrpc.js";
import { PROTOCOL_VERSION_HEADER } from "./protocol.js";
import { type DispatchDeps, dispatchRpc, parseSubscriptionFilter } from "./dispatch.js";
import { RPC_INVALID_PARAMS, RPC_METHOD_NOT_FOUND } from "./jsonrpc.js";
import type { EventSource, StreamSink, SubscriptionRegistry } from "./streaming.js";
import type { McpCaller } from "./tokens.js";

/**
 * Methods that must answer 405 rather than reaching the SPA fallback.
 *
 * `HEAD` is in this list because it must be ASSERTED, but it is not registered
 * explicitly — see `EXPLICITLY_REGISTERED_METHODS`.
 */
export const REJECTED_METHODS = ["GET", "DELETE", "PUT", "PATCH", "HEAD", "OPTIONS"] as const;

/**
 * The subset actually registered. `HEAD` is omitted deliberately: Fastify
 * derives a HEAD route from every GET, so registering it too fails with
 * "Method 'HEAD' already declared for route '/mcp'". Letting the derivation
 * stand means HEAD reuses the GET handler and therefore returns the same 405 —
 * one source of truth for the verdict, still asserted independently.
 */
const EXPLICITLY_REGISTERED_METHODS = REJECTED_METHODS.filter((m) => m !== "HEAD");

/**
 * Request body cap (X11). Bounded rejection beats unbounded memory growth; the
 * limit is generous for a JSON-RPC call but far below anything that threatens
 * the process.
 */
export const MCP_BODY_LIMIT_BYTES = 1024 * 1024;

export interface McpRouteDeps extends AuthDeps, DispatchDeps {
  /** Structured log sink; refusals must be observable (G5). */
  log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  /**
   * Streaming wiring for `subscriptions/listen`. Optional so unit contexts that
   * never open a stream stay simple — but when absent the method is reported
   * unsupported rather than advertised-and-broken.
   */
  streaming?: { registry: SubscriptionRegistry; source: EventSource };
}

/**
 * Whether streaming is actually wired. `server/discover` reads this so the
 * advertised capability matches reality — advertising `listen: true` for a
 * method that always errors is worse than advertising `false`.
 */
export function hasStreaming(deps: McpRouteDeps): boolean {
  return deps.streaming !== undefined;
}

function send(reply: FastifyReply, res: RpcHttpResponse): void {
  // Explicitly NOT setting Mcp-Session-Id anywhere: the revision forbids
  // minting or echoing one (E5).
  reply.code(res.status).type("application/json").send(res.body);
}

/**
 * Mount the `/mcp` routes.
 *
 * Everything is registered inside an ENCAPSULATED Fastify scope. That is
 * load-bearing, not stylistic: `setErrorHandler` is global on the instance it
 * is called on, so calling it directly on the shared `ctx.fastify` would
 * replace the DASHBOARD'S error handler and break the SPA fallback for every
 * other route. Encapsulating confines our handler to this plugin's routes.
 *
 * Returns the registration promise so a caller can await readiness.
 */
export async function mountMcpRoutes(
  fastify: FastifyInstance,
  deps: McpRouteDeps,
): Promise<void> {
  await fastify.register(async (scope) => {
    mountMcpRoutesInScope(scope, deps);
  });
}

/**
 * Open a `subscriptions/listen` stream on the request's own response.
 *
 * The reply is hijacked so Fastify stops managing it, and events are written as
 * newline-delimited JSON for as long as the request lives. Teardown is bound to
 * BOTH `close` and `error` on the raw socket, because S4 (clean close) and S5
 * (transport abort) are different paths to the same required release.
 */
async function handleListen(
  request: FastifyRequest,
  reply: FastifyReply,
  rpc: { id?: string | number | null; params?: unknown },
  caller: McpCaller,
  deps: McpRouteDeps,
): Promise<void> {
  const filter = parseSubscriptionFilter(rpc.params);
  if (!filter.ok) {
    send(reply, rpcError(400, rpc.id ?? null, RPC_INVALID_PARAMS, filter.message, "InvalidSubscriptionFilter"));
    return;
  }
  if (!deps.streaming) {
    send(
      reply,
      rpcError(404, rpc.id ?? null, RPC_METHOD_NOT_FOUND, "subscriptions/listen is not available"),
    );
    return;
  }

  const raw = reply.raw;
  raw.writeHead(200, {
    "content-type": "application/x-ndjson",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  reply.hijack();

  const sink: StreamSink = {
    write: (chunk) => raw.write(chunk),
    end: () => raw.end(),
  };

  const subscription = deps.streaming.registry.open(
    deps.streaming.source,
    filter.sessionIds,
    sink,
    caller,
    {
      // S9 — re-verified per delivery, so a credential revoked mid-stream
      // terminates it rather than letting the stream drain.
      isStillAuthorised: () =>
        authenticate(request.headers.authorization, deps) !== null,
    },
  );

  const release = () => subscription.close();
  raw.on("close", release);
  raw.on("error", release);
}

function mountMcpRoutesInScope(fastify: FastifyInstance, deps: McpRouteDeps): void {
  // Derived ONCE from the real wiring and handed to dispatch, so
  // `server/discover` cannot advertise a capability the transport does not
  // provide. Computed here rather than per request.
  const dispatchDeps: McpRouteDeps = { ...deps, streamingAvailable: hasStreaming(deps) };

  for (const method of EXPLICITLY_REGISTERED_METHODS) {
    fastify.route({
      method,
      url: "/mcp",
      handler: async (_req: FastifyRequest, reply: FastifyReply) => {
        // 405 MUST carry Allow per RFC 9110, and it doubles as discovery: a
        // client that guessed GET learns the endpoint exists and wants POST.
        reply.code(405).header("allow", "POST").type("application/json").send({
          error: "Method Not Allowed",
          message: "The MCP endpoint accepts POST only.",
        });
      },
    });
  }

  fastify.route({
    method: "POST",
    url: "/mcp",
    bodyLimit: MCP_BODY_LIMIT_BYTES,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      // Auth FIRST, and from the header alone. `request.isAuthenticated` is
      // deliberately never consulted here (A4).
      const caller = authenticate(request.headers.authorization, deps);
      if (!caller) {
        deps.log.warn("mcp: refused an unauthenticated request");
        reply.code(401).header("www-authenticate", "Bearer").type("application/json").send({
          error: "Unauthorized",
          message: "A valid bearer credential is required on every /mcp request.",
        });
        return;
      }

      // Fastify has already parsed the body; a syntax error surfaces as a 400
      // from its parser, which we normalise into a JSON-RPC parse error so a
      // client always gets a JSON-RPC shape back (E17).
      const parsed = parseRpcRequest(request.body);
      if (!("ok" in parsed)) {
        send(reply, parsed);
        return;
      }

      // `subscriptions/listen` is a long-lived response stream, so it cannot go
      // through the single-response path below. Handled here, where the reply
      // object still exists to be hijacked.
      if (parsed.request.method === "subscriptions/listen") {
        await handleListen(request, reply, parsed.request, caller, deps);
        return;
      }

      try {
        const res = await dispatchRpc(
          parsed.request,
          request.headers[PROTOCOL_VERSION_HEADER] as string | string[] | undefined,
          caller,
          dispatchDeps,
        );
        send(reply, res);
      } catch (err) {
        // A handler rejection becomes -32603, never a 500 with a stack and
        // never an unhandled rejection (E17, X7).
        const message = err instanceof Error ? err.message : String(err);
        deps.log.error(`mcp: ${parsed.request.method} failed: ${message}`);
        send(
          reply,
          rpcError(500, parsed.request.id ?? null, RPC_INTERNAL_ERROR, "Internal error"),
        );
      }
    },
  });

  /**
   * Normalise Fastify's own body-parse failure into JSON-RPC.
   *
   * Without this, malformed JSON yields Fastify's generic 400 envelope — not a
   * JSON-RPC error object — and a client parsing strictly would choke on the
   * error itself (E17).
   *
   * Scoped to this encapsulated instance (see `mountMcpRoutes`), so a non-/mcp
   * route keeps the dashboard's own error handling. The `request.url` check
   * below is belt-and-braces for a nested registration.
   */
  fastify.setErrorHandler((error: { statusCode?: number }, request, reply) => {
    if (!request.url.startsWith("/mcp")) throw error;
    const status = error.statusCode ?? 500;
    if (status === 413) {
      send(reply, rpcError(413, null, RPC_PARSE_ERROR, "Request body too large"));
      return;
    }
    if (status === 400) {
      send(reply, rpcError(400, extractId(request.body), RPC_PARSE_ERROR, "Parse error"));
      return;
    }
    throw error;
  });
}

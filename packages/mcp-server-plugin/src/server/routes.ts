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
import { minTier, type Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { type AuthDeps, authenticate, credentialFingerprint } from "./auth.js";
import {
  type DispatchDeps,
  dispatchRpc,
  parseSubscriptionFilter,
  versionFailureResponse,
} from "./dispatch.js";
import {
  extractId,
  parseRpcRequest,
  RPC_INTERNAL_ERROR,RPC_INVALID_PARAMS, RPC_METHOD_NOT_FOUND, 
  RPC_PARSE_ERROR,
  type RpcHttpResponse,
  rpcError
} from "./jsonrpc.js";
import { PROTOCOL_VERSION_HEADER, resolveProtocolVersion } from "./protocol.js";
import { AuthFailureThrottle } from "./rate-limit.js";
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
  /** Injectable for tests; a default instance is created when absent. */
  throttle?: AuthFailureThrottle;
  /**
   * Fired at the top of every POST /mcp request. The plugin wires a
   * once-guarded lazy adapter-version diagnostic here, so the check runs on
   * first use rather than at registration.
   */
  onMcpRequest?: () => void;
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
  // The session id is minted by the legacy-era `initialize` adapter and only
  // ever echoed there (D2). A modern-era response NEVER carries one — the
  // revision forbids minting or echoing (E5) — so `res.sessionId` staying
  // undefined for every modern path is the load-bearing invariant here.
  if (res.sessionId) reply.header("mcp-session-id", res.sessionId);
  // The scope challenge rides the refusal response (change: D2).
  if (res.wwwAuthenticate) reply.header("www-authenticate", res.wwwAuthenticate);
  reply.code(res.status).type("application/json").send(res.body ?? "");
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
  // Flush now, rather than letting the headers ride out with the first event.
  // A subscription on an idle session may emit nothing for minutes, and a
  // client that waits for the status line before proceeding would block until
  // then — or time out waiting for headers on a stream that is working fine.
  raw.flushHeaders();
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

/** Static MCP endpoints: the uncapped surface plus the two capped variants. */
const MCP_STATIC_PATHS = ["/mcp", "/mcp/observe", "/mcp/control"] as const;

function mountMcpRoutesInScope(fastify: FastifyInstance, deps: McpRouteDeps): void {
  // Derived ONCE from the real wiring and handed to dispatch, so
  // `server/discover` cannot advertise a capability the transport does not
  // provide. Computed here rather than per request.
  const dispatchDeps: McpRouteDeps = { ...deps, streamingAvailable: hasStreaming(deps) };

  // Brute-force control for the credential comparison below. Only FAILED
  // attempts count, so legitimate traffic is never throttled.
  const throttle = deps.throttle ?? new AuthFailureThrottle();

  /**
   * Rate limiter for the `/mcp` surface, named so static analysis recognizes
   * it as such (`js/missing-rate-limiting`): every POST runs this before the
   * credential comparison. Only FAILED attempts count, so real traffic is
   * never throttled.
   */
  function rateLimit(source: string, fingerprint: string) {
    return throttle.check(source, fingerprint);
  }

  const methodNotAllowed = async (_req: FastifyRequest, reply: FastifyReply) => {
    // 405 MUST carry Allow per RFC 9110, and it doubles as discovery: a
    // client that guessed GET learns the endpoint exists and wants POST.
    reply.code(405).header("allow", "POST").type("application/json").send({
      error: "Method Not Allowed",
      message: "The MCP endpoint accepts POST only.",
    });
  };

  for (const url of MCP_STATIC_PATHS) {
    for (const method of EXPLICITLY_REGISTERED_METHODS) {
      fastify.route({ method, url, handler: methodNotAllowed });
    }
  }

  const postHandler =
    (cap?: Tier) =>
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      // Lazy, once-per-process diagnostics (e.g. the adapter-version floor)
      // belong to first use, not registration.
      deps.onMcpRequest?.();
      // Throttle BEFORE the comparison, so a locked-out source cannot keep
      // spending server CPU on `timingSafeEqual` scans. Keyed on
      // `(ip, credential fingerprint)` — every local session shares `request.ip`,
      // so an ip-only key let one session's stale token deny all the others
      // (design.md D7). The fingerprint is a SHA-256 digest of the presented
      // value and is never logged (X6).
      const source = request.ip;
      const fingerprint = credentialFingerprint(request.headers.authorization);
      const verdict = rateLimit(source, fingerprint);
      if (!verdict.allowed) {
        deps.log.warn(`mcp: throttled ${source} after repeated authentication failures`);
        reply
          .code(429)
          .header("retry-after", String(verdict.retryAfterSeconds))
          .type("application/json")
          .send({ error: "Too Many Requests", message: "Too many failed authentication attempts." });
        return;
      }

      // Auth FIRST, and from the header alone. `request.isAuthenticated` is
      // deliberately never consulted here (A4).
      const caller = authenticate(request.headers.authorization, deps);
      if (!caller) {
        throttle.recordFailure(source, fingerprint);
        deps.log.warn("mcp: refused an unauthenticated request");
        reply.code(401).header("www-authenticate", "Bearer").type("application/json").send({
          error: "Unauthorized",
          message: "A valid bearer credential is required on every /mcp request.",
        });
        return;
      }

      const scopedCaller = (cap ? { ...caller, tier: minTier(caller.tier, cap) } : caller) as McpCaller;

      // A valid credential clears any accumulated failures, so an operator who
      // rotates a stale token recovers immediately instead of serving out a
      // penalty earned by the old one. BEFORE the RPC parse: a well-authorized
      // request with a malformed body returns below without clearing either
      // counter, and a near-threshold ip could then lock healthy credentials
      // out on its next failure (CodeRabbit round 1).
      throttle.recordSuccess(source, fingerprint);

      // Fastify has already parsed the body; a syntax error surfaces as a 400
      // from its parser, which we normalise into a JSON-RPC parse error so a
      // client always gets a JSON-RPC shape back (E17).
      const parsed = parseRpcRequest(request.body);
      if (!("ok" in parsed)) {
        send(reply, parsed);
        return;
      }

      // The SINGLE version-resolution site (D1): before the listen
      // interceptor, so `subscriptions/listen` is subject to the same version
      // contract as every other method (E12) — a gap the pre-dual-era code
      // left open.
      const resolved = resolveProtocolVersion(
        parsed.request.method,
        request.headers[PROTOCOL_VERSION_HEADER] as string | string[] | undefined,
        parsed.request.params,
      );
      if (!resolved.ok) {
        send(reply, versionFailureResponse(resolved.code, parsed.request.id ?? null));
        return;
      }

      // `subscriptions/listen` is a long-lived response stream, so it cannot go
      // through the single-response path below. Handled here, where the reply
      // object still exists to be hijacked. A legacy-era request never opens a
      // stream (D3) — dispatch reports the method removed, and the reply is
      // never hijacked.
      if (parsed.request.method === "subscriptions/listen" && resolved.era === "modern") {
        await handleListen(request, reply, parsed.request, scopedCaller, deps);
        return;
      }

      try {
        const res = await dispatchRpc(parsed.request, resolved, scopedCaller, dispatchDeps, {
          headers: request.headers as Record<string, unknown>,
          remoteAddress: request.ip,
        });
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
    };

  for (const [url, cap] of [
    ["/mcp", undefined],
    ["/mcp/observe", "observe"],
    ["/mcp/control", "control"],
  ] as const) {
    fastify.route({
      method: "POST",
      url,
      bodyLimit: MCP_BODY_LIMIT_BYTES,
      handler: postHandler(cap),
    });
  }

  // `/mcp/<other>` (e.g. `/mcp/operate`) is deliberately NOT a surface: it
  // answers 404 JSON for every method instead of falling through to the SPA
  // handler. More specific static paths above win over this wildcard.
  const notFound = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.code(404).type("application/json").send({
      error: "Not Found",
      message: "Unknown MCP endpoint. Use /mcp, /mcp/observe or /mcp/control.",
    });
  };
  fastify.route({ method: ["GET", "DELETE", "PUT", "PATCH", "OPTIONS"], url: "/mcp/*", handler: notFound });
  fastify.route({ method: "POST", url: "/mcp/*", handler: notFound });

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

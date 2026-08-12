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
import { type DispatchDeps, dispatchRpc } from "./dispatch.js";

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
}

function send(reply: FastifyReply, res: RpcHttpResponse): void {
  // Explicitly NOT setting Mcp-Session-Id anywhere: the revision forbids
  // minting or echoing one (E5).
  reply.code(res.status).type("application/json").send(res.body);
}

export function mountMcpRoutes(fastify: FastifyInstance, deps: McpRouteDeps): void {
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

      try {
        const res = await dispatchRpc(
          parsed.request,
          request.headers[PROTOCOL_VERSION_HEADER] as string | string[] | undefined,
          caller,
          deps,
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
   */
  fastify.setErrorHandler((error, request, reply) => {
    if (request.url !== "/mcp") throw error;
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

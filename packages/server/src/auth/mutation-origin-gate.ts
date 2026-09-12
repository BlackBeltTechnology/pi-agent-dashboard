/**
 * Cross-site MUTATION gate — one `onRequest` hook (issue #625, design D4).
 *
 * CORS decides who may READ a response. It never stops the request from
 * happening, so a blind `fetch("/api/…", {method:"POST", mode:"no-cors"})` from
 * any page reached every dashboard route with the user's ambient trust. The
 * gate refuses a mutation whose `Origin` is not admitted — browsers always send
 * one on a non-GET, and non-browser clients send none and are unaffected.
 *
 * A factory rather than an inline hook so the ordering and the path-matching
 * rule are testable with `fastify.inject` against the REAL code.
 *
 * See change: fix-ws-origin-cswsh.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  type CorsOriginOptions,
  isMutationOriginTrusted,
  sanitizeHeaderForLog,
} from "./cors-origin.js";

/**
 * Methods the gate lets through. `OPTIONS` is safe so preflights still get
 * their CORS headers — the actual cross-site request that follows is then
 * refused by this same hook.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Does this matched route pattern carry state-changing authority? */
function isGuardedRoute(routed: string): boolean {
  return routed.startsWith("/api/") || routed === "/auth/logout";
}

export function createMutationOriginGate(getOpts: () => CorsOriginOptions) {
  return function mutationOriginGate(
    req: FastifyRequest,
    reply: FastifyReply,
    done: (err?: Error) => void,
  ): void {
    // `onRequest` runs AFTER routing, so this is the normalized route PATTERN:
    // `//api/x` and `/foo/../api/x` either fail to route (404, no handler runs)
    // or resolve to the `/api/` pattern and are gated. Raw `req.url` prefix
    // matching is deliberately NOT used — it is what path tricks defeat.
    const routed = req.routeOptions?.url ?? "";
    if (!isGuardedRoute(routed)) return done();
    if (SAFE_METHODS.has(req.method)) return done();
    if (isMutationOriginTrusted(req.headers.origin, req.headers.host, getOpts())) return done();

    console.error(
      `[csrf-gate] rejected ${sanitizeHeaderForLog(req.method)} ${sanitizeHeaderForLog(req.url)} ` +
        `origin=${sanitizeHeaderForLog(req.headers.origin)}`,
    );
    reply.code(403).send({ error: "untrusted origin" });
  };
}

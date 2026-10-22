/**
 * Navigation intent mint / verify (change: harden-client-sinks, design D10).
 *
 *   POST /api/nav-intent         { kind, target } → { success, ni }
 *   POST /api/nav-intent/verify  { ni, kind, target } → { success, ok }
 *
 * Both behind the network guard; the principal is the caller's own
 * (`requestPrincipalKey`), so an intent only verifies for whoever minted it.
 * Cross-site callers cannot mint or read: the CORS allowlist gives them no
 * ACAO and the global mutation-origin gate refuses their POST.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { canonicalNavTarget, isNavIntentKind, type NavIntents, type NavIntentTarget } from "../auth/nav-intent.js";
import { requestPrincipalKey } from "../auth/request-principal.js";
import type { NetworkGuard } from "./route-deps.js";

export interface NavIntentRoutesDeps {
  networkGuard: NetworkGuard;
  intents: NavIntents;
  principalOf?: (request: FastifyRequest) => string;
}

const BODY_LIMIT = 16 * 1024;

export function registerNavIntentRoutes(fastify: FastifyInstance, deps: NavIntentRoutesDeps): void {
  const principalOf = deps.principalOf ?? requestPrincipalKey;

  fastify.post("/api/nav-intent", { preHandler: deps.networkGuard, bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const { kind, target } = (request.body ?? {}) as { kind?: unknown; target?: unknown };
    if (!isNavIntentKind(kind) || canonicalNavTarget(kind, target) === null) {
      return reply.code(400).send({ success: false, error: "invalid intent request" });
    }
    return { success: true, ni: deps.intents.mint(principalOf(request), kind, target as NavIntentTarget) };
  });

  fastify.post("/api/nav-intent/verify", { preHandler: deps.networkGuard, bodyLimit: BODY_LIMIT }, async (request) => {
    const { ni, kind, target } = (request.body ?? {}) as { ni?: unknown; kind?: unknown; target?: unknown };
    const ok = isNavIntentKind(kind) && deps.intents.verify(ni, principalOf(request), kind, target);
    return { success: true, ok };
  });
}

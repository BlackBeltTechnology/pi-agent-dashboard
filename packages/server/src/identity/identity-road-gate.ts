/**
 * Central identity road gate (openspec add-multi-user-identity-plane,
 * D10/D11/D14/D24; tasks 18.14 + 18.28). ONE Fastify `preHandler` hook that
 * decides every classified `/api/*` route (see `http-road-classification.ts`):
 *
 *  - Not enforced ⇒ no-op. A loaded policy gates nothing on an inert plane
 *    (18.14: short-circuit BEFORE `hasPolicy()`).
 *  - `identity` / `session-handler` ⇒ left to the route (pre-auth, or the
 *    handler's own per-item / archive-aware owner gate).
 *  - `session` ⇒ exact `(iss, sub)` owner equality via `canAccessSession`
 *    (D23 local operator passes). Deny = 404 — no owned-vs-missing oracle.
 *    The policy NEVER decides a session road.
 *  - `non-session` / unclassified ⇒ the optional host policy. No policy ⇒
 *    ungated (D24 default). With a policy: local operator passes (break-glass),
 *    no principal ⇒ 403, unclassified ⇒ 403 + `unclassified` audit, else the
 *    policy decides (bounded + fail-closed + audited in `PolicyRegistry`).
 *
 * Runs as `preHandler` so `request.routeOptions.url` is the matched PATTERN and
 * `request.params` is parsed; the resolver hook + D24 floor (`onRequest`) have
 * already settled `request.principal`.
 */
import type { Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { HostPolicy } from "./host-access.js";
import { classifyHttpRoad } from "./http-road-classification.js";
import { canAccessSession, isLocalOperator, sessionPrincipalOf } from "./session-access.js";

export interface IdentityRoadGateDeps {
  /** D21 enforcement predicate (resolver active AND login provider registered). */
  isEnforced: () => boolean;
  /** The single optional host access policy (`PolicyRegistry`). */
  policy: HostPolicy;
  /** Persisted owner of a live-or-archived session, or undefined (ownerless/missing). */
  ownerOf: (sessionId: string) => { iss: string; sub: string } | undefined;
  /** Plugin that registered a route pattern (`route-owner-registry.ts`). */
  routeOwnerOf?: (route: string) => string | undefined;
}

export function createIdentityRoadGate(deps: IdentityRoadGateDeps) {
  return async function identityRoadGate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!deps.isEnforced()) return;
    const route = request.routeOptions?.url ?? "";
    if (!route.startsWith("/api/") && !route.startsWith("/editor/") && !route.startsWith("/live/")) return;

    const road = classifyHttpRoad(request.method, route, deps.routeOwnerOf);
    if (road?.road === "identity" || road?.road === "session-handler") return;

    const principal = sessionPrincipalOf(request);

    if (road?.road === "session") {
      const id = (request.params as Record<string, unknown> | undefined)?.[road.param];
      const owner = typeof id === "string" ? deps.ownerOf(id) : undefined;
      if (!canAccessSession({ active: true, principal, owner })) {
        await reply.code(404).send({ success: false, error: "not_found" });
      }
      return;
    }

    // Non-session (or unclassified) road — the optional host policy.
    if (!deps.policy.hasPolicy()) return;
    if (isLocalOperator(principal)) return;
    if (!principal) {
      await reply.code(403).send({ success: false, error: "forbidden" });
      return;
    }
    const allowed = road
      ? await deps.policy.authorize({ principal: principal as Principal, action: road.action, resource: road.resource })
      : // Unclassified: an empty classification makes `PolicyRegistry` deny +
        // audit `unclassified` without consulting the plugin policy.
        await deps.policy.authorize({ principal: principal as Principal, action: "", resource: { kind: "", route } });
    if (!allowed) await reply.code(403).send({ success: false, error: "forbidden" });
  };
}

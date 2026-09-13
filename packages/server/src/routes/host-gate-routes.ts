/**
 * Host-gate operator read endpoint (design D8): resolved mode, the derived
 * admitted-hostname list, and the recent-refusals ring — the one endpoint the
 * Settings ▸ Security ▸ Allowed hostnames section reads.
 *
 * Auth parity with `GET /api/config` by construction: the same global
 * onRequest chain (bearer / OAuth) plus the same `networkGuard` preHandler —
 * no separate guard, so the two endpoints cannot drift apart.
 *
 * See change: add-host-allowlist-admission.
 */
import type { FastifyInstance } from "fastify";
import { buildHostGateResponse, type HostGateContext, type HostGateState } from "../auth/host-gate.js";
import type { NetworkGuard } from "./route-deps.js";

export function registerHostGateRoutes(
  fastify: FastifyInstance,
  deps: { getCtx: () => HostGateContext; state: HostGateState; networkGuard: NetworkGuard },
): void {
  fastify.get(
    "/api/host-gate",
    { preHandler: deps.networkGuard },
    async () => buildHostGateResponse(deps.getCtx(), deps.state),
  );
}

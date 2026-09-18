/**
 * REST tier gate (change: expand-mcp-tiered-surface, design D1b).
 *
 * ONE additive `onRequest` hook that refuses an off-host device-bearer request
 * whose credential tier is below the tier its matched route requires. It is
 * the REST half of the tier model; the MCP plugin's tool filter is the other,
 * and both read the same `ROUTE_TIERS` map, so they cannot disagree.
 *
 * The gate's scope is deliberately narrow, and each exclusion is a decision:
 *
 *  - It applies ONLY when admission rested on the device bearer
 *    (`request.authVia === "device"`). A browser cookie session, a local-token
 *    caller, or an undecorated request is left to the existing rules — the tier
 *    is a boundary for the compact inter-machine credential, not a new
 *    permission model for same-host browsers.
 *  - A genuinely-local caller (loopback, no forwarding headers) or a
 *    trusted-network caller is exempt, exactly as `networkGuard` treats it:
 *    same-machine processes are trusted via `~/.pi` and the local token
 *    regardless, so there is nothing to narrow.
 *  - `/api/*` only. `/mcp`, `/auth/*` and `/v1/*` have their own admission and
 *    sit outside the route→tier map.
 *
 * The gate only ever REFUSES. A request with no resolvable principal is left
 * untouched, so the pre-change 401/403 path is unchanged (E24).
 *
 * See change: expand-mcp-tiered-surface (task 2.2).
 */
import { rank, type Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { routeTier } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { isBypassedHost, isGenuinelyLocal } from "./localhost-guard.js";

export interface TierRefusal {
  deviceId?: string;
  method: string;
  route: string;
  principalTier: Tier;
  requiredTier: Tier;
}

export interface RouteTierGateDeps {
  /** Live trusted-network list (same source `networkGuard` reads). */
  getTrustedNetworks: () => string[];
  /** Structured refusal sink. Defaults to one `console.warn` line. */
  logRefusal?: (detail: TierRefusal) => void;
}

/** The MCP-shaped scope challenge for a 403 (spec §Scope Challenge). */
function scopeChallenge(scope: Tier): string {
  return `Bearer error="insufficient_scope", scope="${scope}"`;
}

/**
 * Decide whether a request must be refused for being below `requiredTier`.
 * Returns the refusal detail (device id + required scope) or null.
 *
 * Shared by the route gate and by in-handler action-level checks
 * (`POST /api/session/:id/lifecycle` for `force_kill`/`kill_process`), because
 * the network exemptions must apply identically in both places.
 */
export function tierRefusalFor(
  request: FastifyRequest,
  requiredTier: Tier,
  getTrustedNetworks: () => string[],
): { scope: Tier; deviceId?: string } | null {
  if ((request as any).authVia !== "device") return null;
  const headers = request.headers as Record<string, unknown>;
  if (isGenuinelyLocal(request.ip, headers)) return null;
  if (isBypassedHost(request.ip, getTrustedNetworks())) return null;
  const principalTier = (request as any).principalTier as Tier | undefined;
  if (!principalTier) return null;
  if (rank(requiredTier) <= rank(principalTier)) return null;
  return { scope: requiredTier, deviceId: (request as any).principalDeviceId as string | undefined };
}

/** Send the spec-shaped 403 + `WWW-Authenticate` challenge. */
export function sendTierRefusal(reply: FastifyReply, scope: Tier): void {
  reply
    .code(403)
    .header("www-authenticate", scopeChallenge(scope))
    .send({ success: false, error: "insufficient_scope", scope });
}

/**
 * Build the gate hook. A factory (not an inline hook) so the decision table is
 * testable against the real code with `fastify.inject`.
 */
export function createRouteTierGate(deps: RouteTierGateDeps) {
  const log =
    deps.logRefusal ??
    ((detail: TierRefusal) => {
      // One line, structured: `auth.tier_refused` is the stable event name the
      // observability contract names (X8).
      console.warn(`auth.tier_refused ${JSON.stringify(detail)}`);
    });

  return async function routeTierGate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if ((request as any).authVia !== "device") return;

    // `onRequest` runs AFTER routing, so this is the normalized route PATTERN
    // (never the raw URL — path tricks either 404 or resolve to the pattern).
    const route = request.routeOptions?.url ?? "";
    if (!route.startsWith("/api/")) return;

    const requiredTier = routeTier(request.method, route);
    const refusal = tierRefusalFor(request, requiredTier, deps.getTrustedNetworks);
    if (!refusal) return;

    log({
      deviceId: refusal.deviceId,
      method: request.method,
      route,
      principalTier: (request as any).principalTier as Tier,
      requiredTier,
    });

    sendTierRefusal(reply, requiredTier);
  };
}

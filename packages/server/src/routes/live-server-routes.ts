/**
 * REST routes for live-server-preview lifecycle. The `start` endpoint is the
 * SSRF gate (loopback-only via `validateLiveTarget` inside the manager);
 * non-loopback targets are rejected 400 and never reach the proxy.
 *
 * See change: improve-content-editor (live-server-preview §6).
 */

import type { Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import type { Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { COOKIE_NAME, type TokenPayload } from "../auth/auth.js";
import {
  type CapabilityPrincipal,
  type LiveCapabilityStore,
  sessionKeyOf,
} from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import type { NetworkGuard } from "./route-deps.js";

/**
 * Who is minting? Read from what the admission hooks already settled on the
 * request: a device credential, a login session, an identity principal, or
 * nothing revocable (a genuine-local caller).
 */
function capabilityPrincipalOf(request: FastifyRequest): CapabilityPrincipal {
  const r = request as {
    authVia?: string;
    principalTier?: Tier;
    principalDeviceId?: string;
    sessionPayload?: TokenPayload;
    principal?: Principal | null;
    principalExpiresAt?: number | null;
    cookies?: Record<string, string | undefined>;
  };
  const identity = r.principal ?? undefined;
  const identityFields = identity
    ? { identity, ...(typeof r.principalExpiresAt === "number" ? { identityExpiresAt: r.principalExpiresAt } : {}) }
    : {};
  if (r.authVia === "device") {
    return { kind: "device", tier: r.principalTier, deviceId: r.principalDeviceId, ...identityFields };
  }
  if (r.authVia === "session") {
    const cookie = r.cookies?.[COOKIE_NAME];
    return {
      kind: "session",
      tier: r.principalTier,
      session: r.sessionPayload,
      ...(cookie ? { sessionKey: sessionKeyOf(cookie) } : {}),
      ...identityFields,
    };
  }
  return { kind: "local", ...identityFields };
}

export function registerLiveServerRoutes(
  fastify: FastifyInstance,
  liveServerManager: LiveServerManager,
  deps: { networkGuard: NetworkGuard; capabilities?: LiveCapabilityStore },
) {
  const { networkGuard, capabilities } = deps;

  // Register (or reuse) a loopback dev-server target. Returns the proxied path.
  fastify.post<{ Body: { host?: unknown; port?: unknown; label?: unknown } }>(
    "/api/live-server/start",
    { preHandler: networkGuard },
    async (request, reply) => {
      const result = liveServerManager.start(request.body ?? {});
      if (!result.ok) {
        reply.code(400);
        return { success: false, error: result.error } satisfies ApiResponse;
      }
      return { success: true, data: { ...result.target, path: result.path } } satisfies ApiResponse;
    },
  );

  // List the persisted allowlist.
  fastify.get(
    "/api/live-server/list",
    { preHandler: networkGuard },
    async () => {
      return { success: true, data: { servers: liveServerManager.list() } } satisfies ApiResponse;
    },
  );

  // Remove a target from the allowlist. Its capability tokens die with it.
  fastify.delete<{ Params: { id: string } }>(
    "/api/live-server/:id",
    { preHandler: networkGuard },
    async (request) => {
      liveServerManager.remove(request.params.id);
      capabilities?.revokeByTarget(request.params.id);
      return { success: true } satisfies ApiResponse;
    },
  );

  // Mint a per-preview capability path (`control` tier via the route-tier map).
  // The preview frame is sandboxed (opaque origin) and carries no cookie, so the
  // viewer frames this path instead. Unknown target → 404, no token created.
  // See change: retire-trusted-networks-bypass (D5).
  if (capabilities) {
    fastify.post<{ Params: { id: string } }>(
      "/api/live-server/:id/capability",
      { preHandler: networkGuard },
      async (request, reply) => {
        const target = liveServerManager.get(request.params.id);
        if (!target) {
          reply.code(404);
          return { success: false, error: "live-server target not found" } satisfies ApiResponse;
        }
        const { token, expiresAt } = capabilities.mint(target.id, capabilityPrincipalOf(request));
        return { success: true, path: `/live/${target.id}/~c/${token}/`, expiresAt };
      },
    );
  }
}

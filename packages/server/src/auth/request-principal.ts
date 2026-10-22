/**
 * Stable per-principal key for a request the admission hooks already settled
 * (change: harden-client-sinks, D8/D10). Used to rate-limit violation reports
 * and to bind navigation intents to their minting principal.
 *
 *   identity plane principal → `identity:<iss>\0<sub>`
 *   paired device            → `device:<deviceId>`
 *   login session cookie     → `session:<sha256(cookie)>`
 *   otherwise                → `local-operator` (inert plane: the operator the
 *                              network guard admitted — loopback / trusted)
 *
 * Callers register their routes behind the network guard, so an unadmitted
 * request never reaches this function.
 */
import crypto from "node:crypto";
import type { Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import type { FastifyRequest } from "fastify";
import { COOKIE_NAME } from "./auth.js";

export function requestPrincipalKey(request: FastifyRequest): string {
  const r = request as {
    authVia?: string;
    principalDeviceId?: string;
    principal?: Principal | null;
    cookies?: Record<string, string | undefined>;
  };
  if (r.principal) return `identity:${r.principal.iss}\u0000${r.principal.sub}`;
  if (r.authVia === "device" && r.principalDeviceId) return `device:${r.principalDeviceId}`;
  const cookie = r.authVia === "session" ? r.cookies?.[COOKIE_NAME] : undefined;
  if (cookie) return `session:${crypto.createHash("sha256").update(cookie).digest("hex")}`;
  return "local-operator";
}

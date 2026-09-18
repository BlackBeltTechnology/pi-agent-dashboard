/**
 * Bearer device-auth branch (D5/D7).
 *
 * A single additive `onRequest` hook that validates a paired-device bearer
 * token and, on success, sets `request.isAuthenticated = true` — feeding the
 * SAME decision the OAuth cookie and network guard already read. Registered
 * whether or not OAuth is configured, and BEFORE the OAuth plugin so its hook
 * can early-return on an already-authenticated request. Never touches the
 * loopback, trusted-network, or cookie paths.
 *
 * REST: `Authorization: Bearer <token>`.
 * WS:   the durable bearer NEVER rides the WebSocket (F6). A client mints a
 *       short-lived single-use ticket via an authenticated REST call
 *       (`/api/ws-ticket`) and presents only that ticket on the socket
 *       (see `ws-ticket.ts`).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PairedDeviceRegistry } from "../pairing/paired-devices.js";

/** Extract a `Bearer` token from an Authorization header, or null. */
export function parseBearerHeader(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return m ? m[1].trim() : null;
}

/** Register the REST bearer onRequest branch. */
export function registerBearerAuth(
  fastify: FastifyInstance,
  deps: { registry: PairedDeviceRegistry },
): void {
  // Ensure the decorator exists even if the OAuth plugin isn't registered.
  if (!fastify.hasRequestDecorator?.("isAuthenticated")) {
    try {
      fastify.decorateRequest("isAuthenticated", false);
    } catch {
      /* already decorated by another plugin */
    }
  }
  fastify.addHook("onRequest", async (request: FastifyRequest) => {
    if ((request as any).isAuthenticated) return;
    const token = parseBearerHeader(request.headers.authorization);
    const verified = token ? deps.registry.verify(token) : null;
    if (verified) {
      (request as any).isAuthenticated = true;
      // Additive marker: HOW the request authenticated. `operatorGuard` on the
      // token-mint route reads it to REFUSE a device bearer (a paired device
      // must not mint unrevocable credentials). `route-tier-gate` reads it to
      // scope the REST tier check to bearer-admitted requests.
      (request as any).authVia = "device";
      // The credential's tier and id, so the REST tier gate can refuse a route
      // above the bearer's tier and name the device in the refusal log (D1b).
      (request as any).principalTier = verified.tier;
      (request as any).principalDeviceId = verified.id;
    }
  });
}

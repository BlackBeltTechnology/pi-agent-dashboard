/**
 * WHO may mint a `bridge`-scoped WebSocket ticket.
 *
 * `networkGuard` answers "is this caller authenticated at all", and its OR
 * branches include a browser cookie session and any host inside the configured
 * trusted networks. The bridge surface is strictly MORE privileged than `/ws`:
 * a bridge registers sessions and attributes events to them. Letting a
 * LAN-trusted host — or script running in the dashboard's own origin — mint a
 * bridge credential would hand it that surface (@review Audit, major).
 *
 * So the bridge scope is narrowed to the two callers that are actually bridges:
 * a PAIRED DEVICE presenting its durable bearer (the remote-bridge flow, D7),
 * or a genuinely-local caller on this host (which could have used the unix
 * socket and needs no ticket at all on POSIX, but does on Windows — D6).
 *
 * See change: add-pi-gateway-transport-identity (task 6.2).
 */

import { isGenuinelyLocal } from "./localhost-guard.js";

export interface BridgeMintInput {
  /** `Authorization` header, if any. */
  authorization?: string;
  ip: string;
  headers: Record<string, unknown>;
  /** Verify a durable device bearer. */
  verifyDeviceBearer: (token: string) => boolean;
}

export interface BridgeMintDecision {
  allow: boolean;
  reason: string;
}

/** Parse `Authorization: Bearer <token>`. */
function bearerFrom(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return m ? m[1].trim() : null;
}

export function decideBridgeTicketMint(input: BridgeMintInput): BridgeMintDecision {
  const bearer = bearerFrom(input.authorization);
  if (bearer && input.verifyDeviceBearer(bearer)) {
    return { allow: true, reason: "paired device bearer" };
  }
  if (isGenuinelyLocal(input.ip, input.headers)) {
    return { allow: true, reason: "genuinely-local caller" };
  }
  return {
    allow: false,
    reason:
      "bridge tickets require a paired-device bearer or a genuinely-local caller; " +
      "a cookie session or trusted-network host is not sufficient",
  };
}

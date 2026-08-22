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
  /**
   * Resolve a durable device bearer to its paired-device id, or null. Returns
   * the ID rather than a boolean so the minted ticket can carry WHICH device
   * minted it: a session registered over that ticket is then attributable,
   * which is what the origin gate needs to refuse local file reads for a
   * remote session (#E15).
   */
  verifyDeviceBearer: (token: string) => string | null;
}

export interface BridgeMintDecision {
  allow: boolean;
  reason: string;
  /** Set when the caller authenticated AS a paired device. */
  deviceId?: string;
}

/**
 * Parse `Authorization: Bearer <token>` WITHOUT a backtracking regex.
 *
 * The obvious `/^Bearer\s+(.+)$/i` is a polynomial-ReDoS hazard (CodeQL
 * js/polynomial-redos): `\s+` and `.+` both match a space, so `"bearer "`
 * followed by many spaces makes the engine try every split between them. This
 * header is attacker-supplied on an unauthenticated route, which is exactly
 * where that matters. Slicing is linear and states the intent more plainly.
 */
function bearerFrom(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const trimmed = authorization.trim();
  if (trimmed.slice(0, 6).toLowerCase() !== "bearer") return null;
  const rest = trimmed.slice(6);
  // A single-character class test: no repetition, so nothing to backtrack.
  if (!/^\s/.test(rest)) return null;
  const token = rest.trim();
  return token.length > 0 ? token : null;
}

export function decideBridgeTicketMint(input: BridgeMintInput): BridgeMintDecision {
  const bearer = bearerFrom(input.authorization);
  const deviceId = bearer ? input.verifyDeviceBearer(bearer) : null;
  if (deviceId) {
    return { allow: true, reason: "paired device bearer", deviceId };
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

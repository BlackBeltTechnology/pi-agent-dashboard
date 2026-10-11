/**
 * Browser-WS tier gate (change: add-passkey-user-auth).
 *
 * A socket admitted by a login-session cookie carries `sessionTier()` — the
 * session's LIVE tier (passkey users re-read the directory, so a revoke or
 * re-tier applies to the next message, not the next reconnect). Sockets
 * admitted any other way (genuine-local, trusted network, ticket) carry none
 * and are not tier-gated here, exactly like the REST gate's exemptions.
 *
 *  - no `sessionTier`           → allow
 *  - `sessionTier()` is null    → close (revoked / passkeys disabled)
 *  - message tier above session → drop (silent, like the owner gate)
 */
import { rank, type Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { wsMessageTier } from "@blackbelt-technology/pi-dashboard-shared/ws-message-tiers.js";

export type WsTierDecision = { kind: "allow" } | { kind: "close" } | { kind: "drop"; required: Tier; principalTier: Tier };

/** Socket field set at upgrade for cookie-session sockets. */
export interface TieredSocket {
  sessionTier?: () => Tier | null;
}

export function decideWsTier(socket: TieredSocket, messageType: string): WsTierDecision {
  const tierOf = socket.sessionTier;
  if (!tierOf) return { kind: "allow" };
  const tier = tierOf();
  if (tier === null) return { kind: "close" };
  const required = wsMessageTier(messageType);
  return rank(required) <= rank(tier) ? { kind: "allow" } : { kind: "drop", required, principalTier: tier };
}

/** WS close code for a session revoked mid-socket (4000–4999 = application). */
export const WS_CLOSE_SESSION_REVOKED = 4401;

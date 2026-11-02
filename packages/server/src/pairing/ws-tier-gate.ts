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

/** Minimal socket surface the reload sweep reads (a `ws` WebSocket satisfies it). */
export interface SweepableSocket extends TieredSocket {
  readyState?: number;
  close(code?: number, reason?: string): void;
}

/**
 * Close every live socket whose session the auth reload revoked: `sessionTier()` is
 * null (sockets without a `sessionTier` — device ticket, local, trusted — are never
 * touched). Synchronous: when this returns each target has had `close(4401)` issued,
 * without waiting for an inbound frame. Sockets already CLOSING/CLOSED are skipped (no
 * double close; the count is of sockets actually closed). Logs ONE aggregate line (counts
 * only, no identity) when N > 0, none when N = 0. A throwing `sessionTier`/`close` on one
 * socket is logged at error level and does not stop the sweep.
 * See change: close-security-map-high-findings (D3, G7-G10).
 */
export function sweepRevokedSockets(
  gateways: Record<string, { clients: Iterable<SweepableSocket> }>,
  log: (line: string) => void = console.log,
): { total: number; byGateway: Record<string, number> } {
  const byGateway: Record<string, number> = {};
  let total = 0;
  for (const [name, wss] of Object.entries(gateways)) {
    let closed = 0;
    for (const socket of [...wss.clients]) {
      try {
        // 2 = CLOSING, 3 = CLOSED (ws `readyState`); absent ⇒ treated as open.
        if (socket.readyState === 2 || socket.readyState === 3) continue;
        if (!socket.sessionTier || socket.sessionTier() !== null) continue;
        socket.close(WS_CLOSE_SESSION_REVOKED, "session revoked");
        closed++;
      } catch (err) {
        console.error(`[ws-gate] revocation sweep failed for a ${name} socket:`, err);
      }
    }
    byGateway[name] = closed;
    total += closed;
  }
  if (total > 0) {
    const parts = Object.entries(byGateway).map(([name, n]) => `${name}=${n}`);
    log(`[ws-gate] auth reload closed ${total} revoked socket(s) (${parts.join(", ")})`);
  }
  return { total, byGateway };
}

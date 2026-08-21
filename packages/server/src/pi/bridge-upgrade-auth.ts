/**
 * Who may open a bridge WebSocket, decided per transport.
 *
 * The gateway accepted ANY connection that could reach it and let it register
 * an arbitrary `sessionId` — harmless while it only ever listened on
 * loopback, fatal as the container's `0.0.0.0:9999` default. This is the gate
 * that makes the TCP listener defensible (D10b, task 6.3).
 *
 * Three rules, and the asymmetry between them is the whole point:
 *
 *   - **unix socket → allowed with no credential.** The kernel already decided
 *     via `0600` in a `0700` dir (D5). Asking for a token here would
 *     re-introduce the secret the transport exists to delete.
 *   - **remote TCP → a valid, unexpired, single-use, bridge-scoped ticket.**
 *     No grace, ever. A remote peer is exactly the threat.
 *   - **loopback TCP → a bounded deprecation window.** A bridge predating this
 *     change cannot mint a ticket, and refusing them at server-update time
 *     breaks every un-upgraded local session at once — a worse failure than
 *     the window, since loopback was the only thing reachable before. Bounded
 *     by the horizon in D10b, not open-ended.
 *
 * Pure by construction: the refusal cause must be reportable, and an emergent
 * one cannot be.
 *
 * See change: add-pi-gateway-transport-identity (D5, D7, D10b).
 */

import type { TicketConsumption } from "../auth/ws-ticket.js";

export interface BridgeUpgradeInput {
  transport: "unix" | "tcp";
  /** `req.socket.remoteAddress`. Absent is treated as NOT loopback. */
  remoteAddress?: string;
  /** The upgrade URL, carrying `?ticket=`. */
  url?: string;
  /** `sec-websocket-protocol`, the other ticket carrier. */
  secWebSocketProtocol?: string;
  /**
   * `true` once the deprecation window has closed. Defaults to `false` while
   * the horizon in D10b is open.
   */
  requireTicketOnLoopback?: boolean;
  /** Single-use consumption against the `bridge` scope. */
  consumeTicket: (ticket: string | null | undefined) => TicketConsumption;
}

export type BridgeUpgradeVerdict =
  | { allow: true; reason: string; deprecated?: boolean }
  | { allow: false; reason: string };

/** Loopback in every form Node reports it, including IPv4-mapped IPv6. */
export function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.startsWith("::ffff:") ? addr.slice("::ffff:".length) : addr;
  return a === "127.0.0.1" || a === "::1" || a.startsWith("127.");
}

/** Pull the ticket out of the upgrade request (query param or subprotocol). */
function ticketFrom(input: BridgeUpgradeInput): string | null {
  const url = input.url;
  if (url) {
    const q = url.indexOf("?");
    if (q >= 0) {
      const t = new URLSearchParams(url.slice(q + 1)).get("ticket");
      if (t) return t;
    }
  }
  const proto = input.secWebSocketProtocol;
  if (proto) {
    for (const raw of proto.split(",")) {
      const entry = raw.trim();
      if (entry.startsWith("pi-ticket.")) {
        const t = entry.slice("pi-ticket.".length);
        if (t) return t;
      }
    }
  }
  return null;
}

export function decideBridgeUpgrade(input: BridgeUpgradeInput): BridgeUpgradeVerdict {
  if (input.transport === "unix") {
    return { allow: true, reason: "unix socket: authorised by file mode (D5)" };
  }

  const loopback = isLoopbackAddress(input.remoteAddress);
  const consumption = input.consumeTicket(ticketFrom(input));
  if (consumption.ok) {
    return { allow: true, reason: "tcp: valid single-use bridge ticket" };
  }

  if (loopback && input.requireTicketOnLoopback !== true) {
    return {
      allow: true,
      deprecated: true,
      reason:
        `tcp loopback: accepted WITHOUT a bridge ticket (${consumption.reason}) ` +
        `under the deprecation window — this will be refused from 1.0.0`,
    };
  }

  return {
    allow: false,
    reason: `tcp: refused bridge upgrade from ${input.remoteAddress ?? "unknown"} (${consumption.reason})`,
  };
}

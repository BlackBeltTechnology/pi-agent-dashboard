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

import { LOCAL_TOKEN_HEADER } from "../auth/local-token.js";
import { hasProxyForwardingHeaders } from "../auth/localhost-guard.js";
import type { TicketConsumption } from "../auth/ws-ticket.js";

export interface BridgeUpgradeInput {
  transport: "unix" | "tcp";
  /** `req.socket.remoteAddress`. Absent is treated as NOT loopback. */
  remoteAddress?: string;
  /**
   * The upgrade request's headers. Load-bearing: a relay that terminates on
   * this host makes a remote peer PRESENT as `127.0.0.1`, so the loopback
   * grace must also require the absence of proxy-forwarding headers — the
   * same rule `isGenuinelyLocal` applies on the HTTP path.
   */
  headers?: Record<string, unknown> | undefined;
  /** The upgrade URL, carrying `?ticket=`. */
  url?: string;
  /** `sec-websocket-protocol`, the other ticket carrier. */
  secWebSocketProtocol?: string;
  /**
   * `true` once the deprecation window has closed. Defaults to `false` while
   * the horizon in D10b is open.
   */
  requireTicketOnLoopback?: boolean;
  /**
   * Check the `X-Pi-Local-Token` header against this HOME's secret (D6, task
   * 5.3). Injected rather than read here so the decision stays pure and the
   * gateway owns the token's lifetime.
   */
  verifyLocalToken?: (headers: Record<string, unknown> | undefined) => boolean;
  /** Single-use consumption against the `bridge` scope. */
  consumeTicket: (ticket: string | null | undefined) => TicketConsumption;
}

/** Distinct refusal causes — "no credential" ≠ "bad credential" (tasks 5.4/10.3). */
export type BridgeRefusalCause = "local-token-missing" | "local-token-invalid" | "no-ticket";

export type BridgeUpgradeVerdict =
  | { allow: true; reason: string; deprecated?: boolean }
  | { allow: false; reason: string; cause: BridgeRefusalCause };

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

  // "Genuinely local", not merely "says 127.0.0.1": zrok/ngrok, `ssh -L`,
  // socat, a host nginx and docker's userland proxy all present as loopback.
  const loopback =
    isLoopbackAddress(input.remoteAddress) && !hasProxyForwardingHeaders(input.headers ?? {});
  const consumption = input.consumeTicket(ticketFrom(input));
  if (consumption.ok) {
    return { allow: true, reason: "tcp: valid single-use bridge ticket" };
  }

  // A loopback bridge may instead present the local token — a POSITIVE
  // credential (only the same OS user can read the file), which is what makes
  // the Windows path defensible without a unix socket (D6). Checked before the
  // grace so an authorised bridge is logged as credentialed, not as a
  // deprecation.
  const tokenPresented =
    input.headers?.[LOCAL_TOKEN_HEADER] !== undefined && input.headers?.[LOCAL_TOKEN_HEADER] !== "";
  const tokenValid = loopback && input.verifyLocalToken?.(input.headers) === true;
  if (tokenValid) {
    return { allow: true, reason: "tcp loopback: valid local token (D6)" };
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

  // On loopback the local token is the credential that was expected, so the
  // refusal names ITS failure mode rather than the ticket's.
  const cause: BridgeRefusalCause = !loopback
    ? "no-ticket"
    : tokenPresented
      ? "local-token-invalid"
      : "local-token-missing";
  return {
    allow: false,
    cause,
    reason: `tcp: refused bridge upgrade from ${input.remoteAddress ?? "unknown"} (${cause}; ticket: ${consumption.reason})`,
  };
}

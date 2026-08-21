/**
 * Single-use WebSocket upgrade tickets (D11 / F4 / F6).
 *
 * A browser cannot set an Authorization header on a WebSocket, and the durable
 * bearer must NEVER ride the WS URL, header, or logs (F6). So an authenticated
 * client first mints a short-lived, single-use ticket via a REST endpoint (auth
 * by cookie or `Authorization: Bearer`), then opens the socket presenting only
 * that ephemeral ticket. The upgrade handler refuses the socket unless the
 * ticket validates — no authenticated socket ever exists before auth (no
 * TOCTOU).
 *
 * The ticket is:
 *  - high-entropy random, held only in server memory (a stateless JWT could not
 *    enforce single-use);
 *  - deleted synchronously on the FIRST upgrade attempt (reuse → refusal);
 *  - bound to a WS route SCOPE at mint time — a ticket minted for `/ws` cannot
 *    be replayed against a more-privileged `/ws/terminal/*` route.
 */
import crypto from "node:crypto";

/**
 * WS route scopes a ticket may be bound to.
 *
 * `bridge` is the pi-gateway upgrade path. It exists so a REMOTE bridge over
 * TCP authenticates the same way every other remote client does — a paired
 * device mints a scope-bound ticket with its durable bearer and presents only
 * the ticket — and so a bridge ticket can never be replayed against the
 * more-privileged `terminal` or `browser` routes (D7, D10b, task 6.1).
 */
export type WsRouteScope = "browser" | "terminal" | "live" | "bridge";

const TICKET_TTL_MS = 15_000; // seconds-scale; client mints one per connect.
const TICKET_BYTES = 32;

interface TicketEntry {
  scope: WsRouteScope;
  expiresAt: number;
}

/** Outcome of a single-use consumption attempt, with the cause named. */
export type TicketConsumption =
  | { ok: true }
  | { ok: false; reason: "missing" | "unknown" | "expired" | "wrong-scope" };

/** Map a WebSocket upgrade URL to its route scope, or null if not a WS route. */
export function routeScopeForUrl(url: string | undefined): WsRouteScope | null {
  if (!url) return null;
  const pathOnly = url.split("?")[0];
  if (pathOnly === "/ws") return "browser";
  if (pathOnly.startsWith("/ws/terminal/")) return "terminal";
  if (pathOnly.startsWith("/live/")) return "live";
  if (pathOnly === "/ws/bridge") return "bridge";
  return null;
}

const TICKET_SUBPROTOCOL_PREFIX = "pi-ticket.";

/**
 * Extract the ticket from an upgrade request: the `ticket` URL query param
 * (ephemeral, acceptable per D11) or a `pi-ticket.<t>` subprotocol entry.
 */
export function extractTicket(url: string | undefined, secWsProtocol: string | undefined): string | null {
  return ticketFromUrl(url) ?? ticketFromSubprotocol(secWsProtocol);
}

function ticketFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const qIdx = url.indexOf("?");
  if (qIdx < 0) return null;
  return new URLSearchParams(url.slice(qIdx + 1)).get("ticket") || null;
}

function ticketFromSubprotocol(secWsProtocol: string | undefined): string | null {
  if (!secWsProtocol) return null;
  for (const raw of secWsProtocol.split(",")) {
    const entry = raw.trim();
    if (entry.startsWith(TICKET_SUBPROTOCOL_PREFIX)) {
      const t = entry.slice(TICKET_SUBPROTOCOL_PREFIX.length);
      if (t) return t;
    }
  }
  return null;
}

export class WsTicketStore {
  private tickets = new Map<string, TicketEntry>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Mint a single-use ticket bound to a route scope (authenticated caller). */
  mint(scope: WsRouteScope): string {
    // Lazy sweep on each mint clears abandoned (minted-but-unconsumed) tickets
    // so the map can't grow unbounded without a background timer.
    this.sweep();
    const ticket = crypto.randomBytes(TICKET_BYTES).toString("base64url");
    this.tickets.set(ticket, { scope, expiresAt: this.now() + TICKET_TTL_MS });
    return ticket;
  }

  /**
   * Validate + consume a ticket for a given route scope. The ticket is deleted
   * on the FIRST attempt regardless of outcome (single-use). Returns true only
   * when the ticket exists, is unexpired, and matches the requested scope.
   */
  consume(ticket: string | null | undefined, scope: WsRouteScope): boolean {
    return this.consumeDetailed(ticket, scope).ok;
  }

  /**
   * As {@link consume}, but NAMING the refusal cause.
   *
   * The bridge upgrade path has to distinguish "presented nothing" from
   * "replayed a used ticket" from "wrong scope" — an operator debugging a
   * bridge that will not connect cannot act on a single boolean (task 6.3).
   * The causes are reported only in server-side logs, never to the client,
   * so this does not hand an attacker an oracle.
   */
  consumeDetailed(ticket: string | null | undefined, scope: WsRouteScope): TicketConsumption {
    if (!ticket) return { ok: false, reason: "missing" };
    const entry = this.tickets.get(ticket);
    // Delete synchronously on first attempt — no reuse.
    this.tickets.delete(ticket);
    if (!entry) return { ok: false, reason: "unknown" };
    if (entry.expiresAt < this.now()) return { ok: false, reason: "expired" };
    if (entry.scope !== scope) return { ok: false, reason: "wrong-scope" };
    return { ok: true };
  }

  /** Drop expired tickets (memory hygiene). */
  sweep(): void {
    const t = this.now();
    for (const [ticket, entry] of this.tickets) {
      if (entry.expiresAt < t) this.tickets.delete(ticket);
    }
  }
}

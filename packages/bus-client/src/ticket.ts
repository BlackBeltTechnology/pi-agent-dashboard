/**
 * WS ticket handling. A headless client cannot set an Authorization header on a
 * WebSocket, so it first mints a short-lived single-use ticket via
 * `POST /api/ws-ticket` (guarded by the server's `networkGuard` — loopback /
 * trusted only), then opens the socket presenting only that ephemeral ticket.
 * Server TTL is 15 s (`ws-ticket.ts`).
 *
 * See OpenSpec change: add-dashboard-bus-client-scripting.
 */

export const TICKET_TTL_MS = 15_000;

export type WsTicketScope = "browser" | "terminal" | "editor" | "live";

export interface Ticket {
  value: string;
  /** `clock()` reading at mint time — used to detect local expiry before open. */
  mintedAt: number;
  ttlMs: number;
  scope: WsTicketScope;
}

/** True when the ticket's TTL has elapsed against the supplied clock. */
export function isTicketExpired(ticket: Ticket, now: number): boolean {
  return now - ticket.mintedAt >= ticket.ttlMs;
}

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
import type { Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";

/** Core WS route scopes — the only scopes a ticket may ever be bound to. */
const CORE_WS_ROUTE_SCOPES = ["browser", "terminal", "live", "bridge"] as const;
export type CoreWsRouteScope = (typeof CORE_WS_ROUTE_SCOPES)[number];

/**
 * A plugin-registered WS route scope (any kebab-case string owned via
 * `ctx.registerWsRoute`). Structurally distinct from {@link CoreWsRouteScope}
 * only in breadth — ticket minting/consumption take `CoreWsRouteScope`, so
 * plugin scopes are structurally unticketable. See change: add-browser-relay
 * (D1).
 */
export type PluginWsRouteScope = string & {};

/**
 * WS route scopes. The four core scopes plus plugin-registered ones.
 *
 * `bridge` is the pi-gateway upgrade path. It exists so a REMOTE bridge over
 * TCP authenticates the same way every other remote client does — a paired
 * device mints a scope-bound ticket with its durable bearer and presents only
 * the ticket — and so a bridge ticket can never be replayed against the
 * more-privileged `terminal` or `browser` routes (D7, D10b, task 6.1).
 */
export type WsRouteScope = CoreWsRouteScope | PluginWsRouteScope;

/** Narrow a scope string to the four core scopes (plugin scopes → false). */
export function isCoreWsRouteScope(scope: string): scope is CoreWsRouteScope {
  return (CORE_WS_ROUTE_SCOPES as readonly string[]).includes(scope);
}

const TICKET_TTL_MS = 15_000; // seconds-scale; client mints one per connect.
const TICKET_BYTES = 32;

interface TicketEntry {
  scope: CoreWsRouteScope;
  /**
   * Paired-device id of the caller that minted this ticket, for `bridge`
   * scope. Carried so a session registered over a remote bridge can be
   * ATTRIBUTED to a device — origin is derived from the credential, never
   * from anything the bridge says about itself.
   */
  deviceId?: string;
  /**
   * Human principal resolved at mint from the REST caller's credential (§9.1 /
   * design D12). Absent for a principal-less mint (inert era, non-browser
   * scope). Carried onto the socket at upgrade so every session road can
   * owner-gate. NEVER the durable token — only the identity `(iss, sub[, email])`.
   */
  principal?: Principal;
  /**
   * The principal's own expiry (ms epoch), the underlying token `exp`. Bounds
   * the socket lifetime (§9.4); distinct from the ticket's short mint TTL
   * (`expiresAt`). Absent when there is no principal.
   */
  principalExpiresAt?: number;
  expiresAt: number;
}

/** Outcome of a single-use consumption attempt, with the cause named. */
export type TicketConsumption =
  | { ok: true; deviceId?: string; principal?: Principal; principalExpiresAt?: number }
  | { ok: false; reason: "missing" | "unknown" | "expired" | "wrong-scope" };

/**
 * Plugin-scope resolver, injected by the server (change: add-browser-relay D1).
 *
 * The plugin runtime owns the route registry; this auth leaf stays
 * dependency-free and unit-testable, so the mapping is injected here rather
 * than imported. Consulted ONLY after the four core prefixes below — a core
 * path can never resolve to a plugin scope. Returns null for unknown paths.
 */
let pluginScopeResolver: ((pathOnly: string) => PluginWsRouteScope | null) | null = null;

/** Wire (or clear, with null) the plugin-scope resolver. Server startup. */
export function setPluginScopeResolver(
  fn: ((pathOnly: string) => PluginWsRouteScope | null) | null,
): void {
  pluginScopeResolver = fn;
}

/** Map a WebSocket upgrade URL to its route scope, or null if not a WS route. */
export function routeScopeForUrl(url: string | undefined): WsRouteScope | null {
  if (!url) return null;
  const pathOnly = url.split("?")[0];
  if (pathOnly === "/ws") return "browser";
  if (pathOnly.startsWith("/ws/terminal/")) return "terminal";
  if (pathOnly.startsWith("/live/")) return "live";
  if (pathOnly === "/ws/bridge") return "bridge";
  // Plugin-registered scopes resolve LAST, so the core prefixes above always
  // win (plugin prefixes are validated to never overlap them).
  return pluginScopeResolver ? pluginScopeResolver(pathOnly) : null;
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

  /**
   * Mint a single-use ticket bound to a core route scope (authenticated
   * caller). When the REST caller resolved to a principal (§9.1), it is bound
   * here with its `principalExpiresAt`; a principal-less mint records neither,
   * so the resulting socket is principal-less.
   */
  mint(
    scope: CoreWsRouteScope,
    deviceId?: string,
    identity?: { principal: Principal; principalExpiresAt?: number },
  ): string {
    // Lazy sweep on each mint clears abandoned (minted-but-unconsumed) tickets
    // so the map can't grow unbounded without a background timer.
    this.sweep();
    const ticket = crypto.randomBytes(TICKET_BYTES).toString("base64url");
    this.tickets.set(ticket, {
      scope,
      deviceId,
      principal: identity?.principal,
      principalExpiresAt: identity?.principalExpiresAt,
      expiresAt: this.now() + TICKET_TTL_MS,
    });
    return ticket;
  }

  /**
   * Validate + consume a ticket for a given route scope. The ticket is deleted
   * on the FIRST attempt regardless of outcome (single-use). Returns true only
   * when the ticket exists, is unexpired, and matches the requested scope.
   */
  consume(ticket: string | null | undefined, scope: CoreWsRouteScope): boolean {
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
  consumeDetailed(ticket: string | null | undefined, scope: CoreWsRouteScope): TicketConsumption {
    if (!ticket) return { ok: false, reason: "missing" };
    const entry = this.tickets.get(ticket);
    // Delete synchronously on first attempt — no reuse.
    this.tickets.delete(ticket);
    if (!entry) return { ok: false, reason: "unknown" };
    if (entry.expiresAt < this.now()) return { ok: false, reason: "expired" };
    if (entry.scope !== scope) return { ok: false, reason: "wrong-scope" };
    return {
      ok: true,
      deviceId: entry.deviceId,
      principal: entry.principal,
      principalExpiresAt: entry.principalExpiresAt,
    };
  }

  /** Drop expired tickets (memory hygiene). */
  sweep(): void {
    const t = this.now();
    for (const [ticket, entry] of this.tickets) {
      if (entry.expiresAt < t) this.tickets.delete(ticket);
    }
  }
}

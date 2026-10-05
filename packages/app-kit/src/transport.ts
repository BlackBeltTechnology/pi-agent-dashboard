// Ported from InvoiceBot `src/auth/transport.ts`
// (BlackBeltTechnology/invoice-bot-dashboard); generalised for a foreign-origin
// SPA (change: extract-standalone-app-kit, design D2/D4/D5).
//
// The ONE credential-carrying transport seam:
//  • `authedFetch` resolves paths against the dashboard base, never sends
//    cookies, and attaches `Authorization: Bearer <token>` in `oidc` mode — only
//    to the dashboard origin. In `unknown`/`unavailable` mode, or `oidc` mode
//    without a token, it issues NO request at all. In `none` mode it sends a
//    plain request; a 401/403 from the dashboard is surfaced as `not_admitted`.
//  • A dashboard 401 means the token was refused: listeners return the operator
//    to the sign-in state, never an anonymous retry loop.
//  • A socket opens with a freshly minted single-use browser-scope ticket
//    (`POST /api/ws-ticket`); the access token NEVER appears in a URL.
import { apiUrl, isDashboardOrigin, wsUrl } from "./config.js";
import {
  getAccessToken,
  getCredentialEpoch,
  getIdentityMode,
  notifySessionRefused,
  setAccessToken,
  setIdentityMode,
} from "./identity-state.js";

/** Thrown when a request would have to go out without a usable credential. */
export class NoCredentialError extends Error {
  constructor(message = "no live credential") {
    super(message);
    this.name = "NoCredentialError";
  }
}

/** Thrown in `none` mode when the host refuses a credential-less caller (401/403). */
export class NotAdmittedError extends Error {
  readonly code = "not_admitted";
  constructor(readonly status: number) {
    super("not_admitted");
    this.name = "NotAdmittedError";
  }
}

type TicketMinter = () => string | null | Promise<string | null>;
let ticketMinterOverride: TicketMinter | null = null;

/** Test-only: substitute (or clear) the WS-ticket mint. */
export function setTicketMinterForTests(minter: TicketMinter | null): void {
  ticketMinterOverride = minter;
}

/**
 * Test-only: `oidc` mode, a fake live credential and a synchronous ticket mint,
 * so a socket can be opened without a provider.
 */
export function authorizeTestSockets(token = "test-access-token"): void {
  setIdentityMode("oidc");
  setAccessToken(token);
  setTicketMinterForTests(() => "test-ticket");
}

/**
 * Fetch with the acting operator's credential. Preserves a caller-supplied
 * `Authorization` header; refuses (throws, issues nothing) when no request may
 * be sent in the current identity mode.
 */
export async function authedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const { mode, token } = sendableCredential();
  const isRequest = typeof Request !== "undefined" && input instanceof Request;
  const url = apiUrl(isRequest ? input.url : String(input));
  const toDashboard = isDashboardOrigin(url);
  const headers = new Headers(init?.headers ?? (isRequest ? input.headers : undefined));
  if (token && toDashboard && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);

  const target = isRequest ? new Request(url, input) : url;
  const res = await fetch(target, { ...init, headers, credentials: "omit" });
  // Only the dashboard can refuse the dashboard credential; a foreign origin's
  // 401/403 is that origin's business and is returned as-is.
  if (toDashboard) checkRefusal(mode, res.status, token);
  return res;
}

/** The mode and bearer a request may go out with; throws `NoCredentialError` when none may. */
function sendableCredential(): { mode: "oidc" | "none"; token: string | null } {
  const mode = getIdentityMode();
  if (mode === "none") return { mode, token: null };
  const token = getAccessToken();
  if (mode !== "oidc" || !token) throw new NoCredentialError();
  return { mode, token };
}

/**
 * A dashboard 401 refuses the credential the request was sent with — only a
 * refusal of the STILL-live token signals the session (a late 401 for a token
 * that was since renewed or replaced must not sign out the newer session). In
 * `none` mode a 401/403 means the caller is not admitted.
 */
function checkRefusal(mode: "oidc" | "none", status: number, sentToken: string | null): void {
  if (status === 401 && getAccessToken() === sentToken) notifySessionRefused();
  if (mode === "none" && (status === 401 || status === 403)) throw new NotAdmittedError(status);
}

/**
 * Mint a fresh single-use WS ticket at the dashboard with the live access
 * token. Returns null when there is no credential or the mint fails.
 */
export async function mintWsTicket(scope: "browser" = "browser"): Promise<string | null> {
  if (ticketMinterOverride) return await ticketMinterOverride();
  try {
    const res = await authedFetch("/api/ws-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { ticket?: unknown }; ticket?: unknown } | null;
    const ticket = body?.data?.ticket ?? body?.ticket;
    return typeof ticket === "string" && ticket ? ticket : null;
  } catch {
    return null;
  }
}

/**
 * Append `?ticket=<t>` (or `&ticket=`) to a WS url, preserving an existing
 * query and keeping any `#fragment` last — a ticket inside the fragment would
 * never reach the server.
 */
export function appendWsTicket(url: string, ticket: string): string {
  const hashAt = url.indexOf("#");
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const fragment = hashAt === -1 ? "" : url.slice(hashAt);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}ticket=${encodeURIComponent(ticket)}${fragment}`;
}

/**
 * The URL a socket MUST open with, or `null` when it must NOT be opened at all.
 *
 * - `unknown` / `unavailable` → `null`.
 * - A socket on a foreign origin → its URL unchanged, never a ticket.
 * - `none` → the plain dashboard socket URL.
 * - `oidc` → `<wsUrl>?ticket=<t>`, or `null` without a token or a ticket.
 *
 * Stays synchronous when the (test) minter is synchronous.
 */
export function ticketSocketUrl(path: string): string | null | Promise<string | null> {
  const mode = getIdentityMode();
  if (mode !== "oidc" && mode !== "none") return null;
  const url = wsUrl(path);
  if (!isDashboardOrigin(url) || mode === "none") return url;
  if (!getAccessToken()) return null;
  // A sign-out or refusal while the mint is in flight must not open a socket
  // with a ticket minted for the previous credential.
  const epoch = getCredentialEpoch();
  const withTicket = (ticket: string | null) =>
    ticket && getCredentialEpoch() === epoch && getAccessToken() ? appendWsTicket(url, ticket) : null;
  if (ticketMinterOverride) {
    const minted = ticketMinterOverride();
    if (typeof minted === "string") return withTicket(minted);
    if (minted === null) return null;
    return minted.then(withTicket);
  }
  return mintWsTicket("browser").then(withTicket);
}

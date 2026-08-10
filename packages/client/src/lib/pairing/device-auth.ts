/**
 * Paired-device bearer store + consumption for the browser dashboard.
 *
 * A phone paired via the `/pair` view holds a durable bearer token (the same
 * credential the Electron shell keeps in its OS keyring). The browser has no
 * keyring, so we persist it in `localStorage` and teach the dashboard's HTTP +
 * WebSocket layers to present it — the web-client analogue of the shell's
 * `connect.ts`:
 *   - REST: a global `fetch` wrapper adds `Authorization: Bearer <token>` to
 *     same-origin `/api/*` (and `/v1/*`) requests when a bearer is stored and
 *     no Authorization header is already set.
 *   - WS: the durable bearer NEVER rides the socket (F6). Before each connect
 *     the client mints a short-lived single-use ticket via `/api/ws-ticket`
 *     (authenticated by the bearer) and presents only that ticket on `/ws`.
 *
 * See change: make-pairing-qr-camera-scannable.
 */
import { getApiBase } from "../api/api-context.js";

const BEARER_KEY = "pi-dashboard:device-bearer";

/** The stored paired-device bearer token, or null when this browser is unpaired. */
export function getDeviceBearer(): string | null {
  try {
    return localStorage.getItem(BEARER_KEY);
  } catch {
    return null;
  }
}

/** Persist the paired-device bearer minted by a successful `/pair` handshake. */
export function storeDeviceBearer(token: string): void {
  try {
    localStorage.setItem(BEARER_KEY, token);
  } catch {
    /* private-mode / storage-disabled — pairing still completes in-session */
  }
}

/** Forget the paired-device bearer (revoked/expired token cleanup). */
export function clearDeviceBearer(): void {
  try {
    localStorage.removeItem(BEARER_KEY);
  } catch {
    /* ignore */
  }
}

/** True for a request whose credentials the device bearer should authenticate. */
function shouldAttachBearer(url: string): boolean {
  try {
    const u = new URL(url, window.location.origin);
    if (u.origin !== window.location.origin) return false;
    return u.pathname.startsWith("/api/") || u.pathname.startsWith("/v1/");
  } catch {
    return false;
  }
}

/**
 * Wrap `window.fetch` once so every same-origin API request carries the paired-
 * device bearer. Idempotent: re-invocation is a no-op. Never overrides an
 * Authorization header a caller set explicitly.
 */
export function installDeviceAuthFetch(): void {
  const w = window as unknown as { __piDeviceAuthFetch?: boolean };
  if (w.__piDeviceAuthFetch) return;
  w.__piDeviceAuthFetch = true;

  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = getDeviceBearer();
    if (!token) return original(input, init);

    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!shouldAttachBearer(url)) return original(input, init);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
    return original(input, { ...init, headers });
  };
}

/**
 * Mint a fresh single-use WS ticket for `scope` using the stored bearer.
 * Returns null when this browser is unpaired (cookie/loopback auth path) or the
 * mint fails — callers fall back to opening the socket without a ticket.
 */
export async function mintWsTicket(scope: "browser" = "browser"): Promise<string | null> {
  const token = getDeviceBearer();
  if (!token) return null;
  try {
    const res = await fetch(`${getApiBase()}/api/ws-ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ scope }),
    });
    const json = (await res.json()) as { success?: boolean; data?: { ticket?: string } };
    return json?.data?.ticket ?? null;
  } catch {
    return null;
  }
}

/** Append `?ticket=<t>` (or `&ticket=`) to a WS url, preserving existing query. */
export function appendWsTicket(wsUrl: string, ticket: string): string {
  const sep = wsUrl.includes("?") ? "&" : "?";
  return `${wsUrl}${sep}ticket=${encodeURIComponent(ticket)}`;
}

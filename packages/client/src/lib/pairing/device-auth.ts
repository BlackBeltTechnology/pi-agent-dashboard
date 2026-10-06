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
 * Same-origin browsers do NOT keep the durable bearer in `localStorage` (any XSS
 * would exfiltrate it): right after pairing they exchange it ONCE for an httpOnly
 * `SameSite=Strict` `pi_dash_device` cookie scoped to `/api/`
 * (`POST /api/device-session`) and keep only a non-secret paired MARKER. A legacy
 * stored bearer is exchanged and removed at startup. Cross-origin API bases keep
 * the bearer (no cookie crosses origins). See change:
 * harden-trust-and-credential-boundaries (D5).
 *
 * See change: make-pairing-qr-camera-scannable.
 */
import { getApiBase, VITE_API_URL } from "../api/api-context.js";
import { getAccessToken } from "@blackbelt-technology/pi-dashboard-client-utils/identity/token-store";

const BEARER_KEY = "pi-dashboard:device-bearer";
const PAIRED_KEY = "pi-dashboard:device-paired";

/** True when this browser is paired via the httpOnly device cookie (non-secret marker). */
export function isDevicePaired(): boolean {
  try {
    return localStorage.getItem(PAIRED_KEY) === "1";
  } catch {
    return false;
  }
}

function setDevicePaired(on: boolean): void {
  try {
    if (on) localStorage.setItem(PAIRED_KEY, "1");
    else localStorage.removeItem(PAIRED_KEY);
  } catch {
    /* storage disabled */
  }
}

/** Is the API on this page's own origin (so a cookie can authenticate it)? */
function isSameOriginApi(): boolean {
  try {
    // Early in startup the global base is not yet set; the build-time URL stands in.
    const base = getApiBase() || VITE_API_URL;
    return !base || new URL(base, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

type ExchangeResult = "ok" | "rejected" | "error";

/** Exchange a device bearer for the httpOnly cookie. */
async function exchangeDeviceSession(token: string): Promise<ExchangeResult> {
  try {
    const res = await fetch(`${getApiBase() || VITE_API_URL}/api/device-session`, {
      method: "POST",
      credentials: "same-origin",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return "ok";
    return res.status === 401 || res.status === 403 ? "rejected" : "error";
  } catch {
    return "error";
  }
}

/**
 * Persist a freshly minted pairing bearer. Same-origin: exchange for the cookie
 * (awaited, so the next navigation already carries it) and keep only the marker;
 * if the exchange fails the bearer is kept as before. Cross-origin: keep the bearer.
 */
export async function finishDevicePairing(token: string): Promise<void> {
  if (isSameOriginApi() && (await exchangeDeviceSession(token)) === "ok") {
    setDevicePaired(true);
    clearDeviceBearer();
    return;
  }
  storeDeviceBearer(token);
}

/**
 * Startup migration: a legacy `localStorage` bearer is exchanged for the cookie and
 * removed (200), dropped when rejected (401/403), kept on a network error.
 */
export async function migrateLegacyDeviceBearer(): Promise<void> {
  const legacy = getDeviceBearer();
  if (!legacy || !isSameOriginApi()) return;
  const result = await exchangeDeviceSession(legacy);
  if (result === "ok") {
    setDevicePaired(true);
    clearDeviceBearer();
  } else if (result === "rejected") {
    clearDeviceBearer();
  }
}

/** The stored paired-device bearer token, or null when this browser is unpaired. */
export function getDeviceBearer(): string | null {
  try {
    return localStorage.getItem(BEARER_KEY);
  } catch {
    return null;
  }
}

/**
 * The bearer to present on same-origin API/WS calls (§12.2). The identity-plane
 * access token (in-memory, PKCE) takes precedence; the durable paired-device
 * bearer is the fallback. Distinct credentials, one presentation seam. Null
 * when this browser is neither signed-in via the identity plane nor paired
 * (cookie/loopback auth path).
 */
export function getApiBearer(): string | null {
  return getAccessToken() ?? getDeviceBearer();
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
    const token = getApiBearer();
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
export async function mintWsTicket(scope: "browser" | "terminal" | "live" = "browser"): Promise<string | null> {
  const token = getApiBearer();
  const cookieOnly = !token && isDevicePaired();
  if (!token && !cookieOnly) return null;
  try {
    const res = await fetch(`${getApiBase()}/api/ws-ticket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(cookieOnly ? { credentials: "same-origin" as const } : {}),
      body: JSON.stringify({ scope }),
    });
    // Stale marker (cookie revoked/expired): forget it.
    if (cookieOnly && res.status === 401) setDevicePaired(false);
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

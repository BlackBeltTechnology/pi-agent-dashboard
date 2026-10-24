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
 * (`POST /api/device-session`) and keep only a non-secret paired MARKER. Cross-origin
 * API bases keep the bearer (no cookie crosses origins). See change:
 * harden-trust-and-credential-boundaries (D5).
 *
 * Bearers live in ONE slot PER SERVER ORIGIN (`pi-dashboard:device-bearer:<origin>`,
 * JSON `{token, expiresAt?}`); the wrapper attaches only the slot of the request's
 * own origin. The legacy global key `pi-dashboard:device-bearer` is DISCARDED at
 * startup on every path (never exchanged, never sent, never copied). A browser-held
 * (cross-origin) bearer is short-lived: it is rotated at startup and when under 25 %
 * of its lifetime remains (call-driven, at most once a minute), and a 401
 * `bearer_expired` clears that origin's slot and navigates once to the pairing
 * landing. See change: harden-auth-credentials (D5).
 *
 * See change: make-pairing-qr-camera-scannable.
 */

import { getAccessToken } from "@blackbelt-technology/pi-dashboard-client-utils/identity/token-store";
import { getApiBase, VITE_API_URL } from "../api/api-context.js";
import { requestAccessTarget } from "./request-access-target.js";

/** Legacy single global bearer key — only ever DELETED (see `migrateLegacyDeviceBearer`). */
const LEGACY_BEARER_KEY = "pi-dashboard:device-bearer";
const SLOT_PREFIX = `${LEGACY_BEARER_KEY}:`;
const PAIRED_KEY = "pi-dashboard:device-paired";
const ROTATE_PATH = "/api/paired-devices/rotate";
/** Rotate when less than this fraction of the bearer's lifetime remains. */
const ROTATE_REMAINING_FRACTION = 0.25;
/** A failed/any rotation attempt is not repeated sooner than this (call-driven retry). */
const ROTATE_RETRY_INTERVAL_MS = 60_000;
/** Nominal browser-bearer lifetime (7 d); the issue time assumed for a slot this page session did not write. */
const NOMINAL_LIFETIME_MS = 7 * 24 * 3_600_000;

/** A server's stored bearer. `expiresAt` (epoch ms) is absent for a non-expiring bearer. */
interface BearerSlot {
  token: string;
  expiresAt?: number;
}

const slotKey = (origin: string): string => `${SLOT_PREFIX}${origin}`;

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

const pageOrigin = (): string => window.location.origin;

/** Origin of an API base (`""` → this page's origin); null when unparseable. */
function originOf(base: string): string | null {
  try {
    return new URL(base, pageOrigin()).origin;
  } catch {
    return null;
  }
}

/** The configured API base; early in startup the global base is not yet set, so the build-time URL stands in. */
const configuredApiBase = (): string => getApiBase() || VITE_API_URL;

/** Origin of the server this page currently talks to (the slot a stored bearer belongs to). */
const apiOrigin = (): string => originOf(configuredApiBase()) ?? pageOrigin();

/** Is the API on this page's own origin (so a cookie can authenticate it)? */
function isSameOriginApi(): boolean {
  const base = configuredApiBase();
  return !base || originOf(base) === pageOrigin();
}

/**
 * Fields a pairing redeem/poll (and rotate) request body adds to declare that the
 * bearer will be kept in BROWSER storage: `{holder:"browser"}` only when the API is
 * cross-origin; `{}` for same-origin (cookie path). Electron/CLI keyring paths never
 * use this module. See change: harden-auth-credentials (D5).
 */
export function browserHolderBody(): { holder?: "browser" } {
  return isSameOriginApi() ? {} : { holder: "browser" };
}

// ── Per-origin bearer slots ─────────────────────────────────────────

/** Bearers whose `localStorage` write failed: kept for the page session (newest wins over storage). */
const memorySlots = new Map<string, BearerSlot>();
/** When this page session wrote a given token (its issue time, for the 25 % threshold). */
const issuedAt = new Map<string, { token: string; at: number }>();

function readSlot(origin: string): BearerSlot | null {
  const mem = memorySlots.get(origin);
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(slotKey(origin));
    if (!raw) return null;
    const v = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown } | null;
    if (!v || typeof v.token !== "string" || !v.token) return null;
    return typeof v.expiresAt === "number" && Number.isFinite(v.expiresAt)
      ? { token: v.token, expiresAt: v.expiresAt }
      : { token: v.token };
  } catch {
    return null;
  }
}

function writeSlot(origin: string, slot: BearerSlot): void {
  issuedAt.set(origin, { token: slot.token, at: Date.now() });
  try {
    localStorage.setItem(slotKey(origin), JSON.stringify(slot));
    memorySlots.delete(origin);
  } catch {
    // Quota / storage disabled: the new bearer still authenticates this page session.
    memorySlots.set(origin, slot);
    emitNotice("storage-failed");
  }
}

function clearSlot(origin: string): void {
  memorySlots.delete(origin);
  issuedAt.delete(origin);
  try {
    localStorage.removeItem(slotKey(origin));
  } catch {
    /* ignore */
  }
}

// ── Notices (one warning per page session when a rotated bearer cannot be persisted) ──

type DeviceBearerNotice = "storage-failed";
type NoticeListener = (notice: DeviceBearerNotice) => void;
const noticeListeners = new Set<NoticeListener>();
let pendingNotice: DeviceBearerNotice | null = null;
let noticeShown = false;

function emitNotice(notice: DeviceBearerNotice): void {
  if (noticeShown) return;
  noticeShown = true;
  console.warn("[device-auth] could not persist the rotated device bearer; keeping it in memory for this page session");
  if (noticeListeners.size === 0) pendingNotice = notice;
  for (const l of noticeListeners) l(notice);
}

/** Subscribe to user-facing notices; a notice raised before any subscriber exists is replayed once. */
export function onDeviceBearerNotice(listener: NoticeListener): () => void {
  noticeListeners.add(listener);
  if (pendingNotice) {
    const n = pendingNotice;
    pendingNotice = null;
    listener(n);
  }
  return () => noticeListeners.delete(listener);
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

/** Set only across the synchronous call into `fetch` made by `cookieAloneAuthenticates`. */
let suppressBearer = false;

/**
 * Does the httpOnly device cookie ALONE authenticate an `/api/` request? An
 * `observe`-tier GET carrying no Authorization header (the shared fetch wrapper
 * is told to attach none, so a stale legacy bearer / identity token cannot
 * mask a dropped cookie). Any non-2xx or transport error = not proven.
 */
async function cookieAloneAuthenticates(): Promise<boolean> {
  try {
    suppressBearer = true;
    const pending = fetch(`${getApiBase() || VITE_API_URL}/api/favorite-models`, { credentials: "same-origin" });
    suppressBearer = false;
    return (await pending).ok;
  } catch {
    return false;
  } finally {
    suppressBearer = false;
  }
}

/** Outcome of `finishDevicePairing`. */
export interface FinishDevicePairingResult {
  /** Same-origin pairing whose cookie could not be proven: the bearer was KEPT and the user should be told. */
  keepFailed: boolean;
}

/**
 * Persist a freshly minted pairing bearer (QR and knock share this one policy).
 * Same-origin: exchange for the cookie (awaited, so the next navigation already
 * carries it), then discard the bearer ONLY after a cookie-only authenticated
 * `/api/` request succeeds and keep just the marker; otherwise KEEP the bearer in
 * this origin's slot (it keeps authenticating) and report `keepFailed` so the
 * landing can say so. Cross-origin: keep `{token, expiresAt}` (the `expiresAt` the
 * pairing response returned; no cookie crosses origins; nothing to report).
 * See change: add-lan-knock-pairing (D15), harden-auth-credentials (D5).
 */
export async function finishDevicePairing(token: string, expiresAt?: number): Promise<FinishDevicePairingResult> {
  if (!isSameOriginApi()) {
    storeDeviceBearer(token, expiresAt);
    return { keepFailed: false };
  }
  if ((await exchangeDeviceSession(token)) === "ok" && (await cookieAloneAuthenticates())) {
    setDevicePaired(true);
    clearDeviceBearer();
    return { keepFailed: false };
  }
  storeDeviceBearer(token);
  return { keepFailed: true };
}

/**
 * Startup: DISCARD the legacy global bearer slot on every path — it may hold another
 * server's bearer, so it is never exchanged for a cookie, never sent and never copied
 * into a per-origin slot (the user pairs again once per cross-origin server).
 * See change: harden-auth-credentials (D5).
 */
export async function migrateLegacyDeviceBearer(): Promise<void> {
  try {
    localStorage.removeItem(LEGACY_BEARER_KEY);
  } catch {
    /* storage disabled */
  }
}

/** The stored paired-device bearer token for the current API origin, or null when unpaired. */
export function getDeviceBearer(): string | null {
  return readSlot(apiOrigin())?.token ?? null;
}

/**
 * The bearer to present on API/WS calls (§12.2). The identity-plane access token
 * (in-memory, PKCE) takes precedence; the durable paired-device bearer of the
 * current API origin is the fallback. Distinct credentials, one presentation seam.
 * Null when this browser is neither signed-in via the identity plane nor paired
 * (cookie/loopback auth path).
 */
export function getApiBearer(): string | null {
  return getAccessToken() ?? getDeviceBearer();
}

/** Persist the paired-device bearer (with its `expiresAt`, epoch ms, when known) in the current origin's slot. */
export function storeDeviceBearer(token: string, expiresAt?: number): void {
  writeSlot(apiOrigin(), typeof expiresAt === "number" && Number.isFinite(expiresAt) ? { token, expiresAt } : { token });
}

/** Forget the current origin's paired-device bearer (revoked/expired token cleanup). */
export function clearDeviceBearer(): void {
  clearSlot(apiOrigin());
}

// ── Rotation (browser-held, cross-origin bearers) ───────────────────

interface RotationState {
  lastAttemptAt: number | null;
  inFlight: boolean;
  /** The server answered 404: it has no rotation route; do not ask again this page session. */
  unsupported: boolean;
}
const rotation = new Map<string, RotationState>();

/** Origins whose `bearer_expired` re-pair navigation already started (dedupe across concurrent 401s). */
const repairing = new Set<string>();

/** Reset module-held runtime state (rotation bookkeeping, memory slots, notices). For tests. */
export function resetDeviceAuthRuntimeForTests(): void {
  memorySlots.clear();
  issuedAt.clear();
  rotation.clear();
  repairing.clear();
  noticeShown = false;
  pendingNotice = null;
  noticeListeners.clear();
}

function stateFor(origin: string): RotationState {
  let st = rotation.get(origin);
  if (!st) {
    st = { lastAttemptAt: null, inFlight: false, unsupported: false };
    rotation.set(origin, st);
  }
  return st;
}

/** Is less than 25 % of the current bearer's lifetime (issue → `expiresAt`) left? */
function rotationDue(origin: string, slot: BearerSlot, now: number): boolean {
  if (slot.expiresAt === undefined) return false;
  const seen = issuedAt.get(origin);
  // Not written by this page session (another tab / an earlier load): assume the nominal
  // lifetime. Startup rotation always follows a load, so a ceiling-capped bearer's real
  // issue time is known from the first rotate this page performs.
  const issued = seen && seen.token === slot.token ? seen.at : slot.expiresAt - NOMINAL_LIFETIME_MS;
  const lifetime = slot.expiresAt - issued;
  return slot.expiresAt - now < lifetime * ROTATE_REMAINING_FRACTION;
}

/** A 200 rotate answer is usable only with a non-empty token AND a finite future `expiresAt`. */
function parseRotated(body: unknown, now: number): BearerSlot | null {
  const root = body as { data?: unknown } | null;
  const v = (root && typeof root === "object" && root.data && typeof root.data === "object" ? root.data : root) as {
    token?: unknown;
    expiresAt?: unknown;
  } | null;
  if (!v || typeof v.token !== "string" || !v.token) return null;
  if (typeof v.expiresAt !== "number" || !Number.isFinite(v.expiresAt) || v.expiresAt <= now) return null;
  return { token: v.token, expiresAt: v.expiresAt };
}

/**
 * One `POST /api/paired-devices/rotate` with the origin's current bearer. The slot is
 * only ever replaced by a well-formed 200 answer: 404 (old server), 409
 * (`bearer_superseded` — another tab won; its token arrives via the `storage` event),
 * 429/5xx, transport errors and malformed bodies all leave it untouched. A 401
 * `bearer_expired` is handled by the fetch wrapper like any other request.
 */
async function rotateBearer(origin: string): Promise<void> {
  const st = stateFor(origin);
  const slot = readSlot(origin);
  if (!slot || st.inFlight || st.unsupported) return;
  st.inFlight = true;
  st.lastAttemptAt = Date.now();
  try {
    const res = await window.fetch(`${origin}${ROTATE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${slot.token}` },
      body: JSON.stringify({ holder: "browser" }),
    });
    if (res.status === 404) {
      st.unsupported = true;
      return;
    }
    if (res.status !== 200) return;
    const fresh = parseRotated(await res.json().catch(() => null), Date.now());
    if (fresh) writeSlot(origin, fresh);
  } catch {
    /* transport error: keep the old bearer; retried on a later call */
  } finally {
    st.inFlight = false;
  }
}

/** Call-driven rotation check for a request (to `url`) that was just authenticated with `origin`'s bearer. */
function maybeRotate(origin: string, slot: BearerSlot, url: string): void {
  if (origin === pageOrigin()) return; // same-origin kept bearer: non-expiring, never declared a holder
  if (new URL(url, pageOrigin()).pathname === ROTATE_PATH) return; // the rotation call itself
  const st = stateFor(origin);
  if (st.inFlight || st.unsupported) return;
  const now = Date.now();
  if (st.lastAttemptAt !== null && now - st.lastAttemptAt < ROTATE_RETRY_INTERVAL_MS) return;
  if (rotationDue(origin, slot, now)) void rotateBearer(origin);
}

/**
 * Startup rotation: a browser-held bearer for the selected cross-origin server is
 * rotated once at page start regardless of its remaining lifetime (so the client
 * always knows a fresh `expiresAt`). `apiBase` defaults to the configured base; the
 * caller may pass the one derived from the saved server before React has set it.
 */
export async function startDeviceBearerRotation(apiBase?: string): Promise<void> {
  const origin = originOf(apiBase || configuredApiBase()) ?? pageOrigin();
  if (origin === pageOrigin() || !readSlot(origin)) return;
  await rotateBearer(origin);
}

// ── Expired bearer → re-pair ────────────────────────────────────────

/** Clear `origin`'s slot (if still holding `sentToken`) and navigate ONCE to its pairing landing. */
async function handleBearerExpired(res: Response, origin: string, sentToken: string): Promise<void> {
  let code: unknown;
  try {
    code = ((await res.json()) as { code?: unknown } | null)?.code;
  } catch {
    return;
  }
  if (code !== "bearer_expired") return;
  if (readSlot(origin)?.token !== sentToken) return; // another tab already replaced it
  clearSlot(origin);
  if (repairing.has(origin)) return;
  repairing.add(origin);
  // client-sinks: allow — origin comes from the configured server base; fixed `/pair?request` path
  window.location.assign(requestAccessTarget(origin, pageOrigin()).href);
}

let storageListening = false;
/** Another tab wrote/removed a slot: drop our in-memory override so the stored value wins. */
function listenForSlotChanges(): void {
  if (storageListening) return;
  storageListening = true;
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key?.startsWith(SLOT_PREFIX)) memorySlots.delete(e.key.slice(SLOT_PREFIX.length));
  });
}

/** The URL's `/api/*` or `/v1/*` request origin, or null for anything the bearer never covers. */
function bearerTargetOrigin(url: string): string | null {
  try {
    const u = new URL(url, pageOrigin());
    return u.pathname.startsWith("/api/") || u.pathname.startsWith("/v1/") ? u.origin : null;
  } catch {
    return null;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** The request's headers, with `Bearer <token>` added unless the caller already set Authorization. */
function headersWithBearer(input: RequestInfo | URL, init: RequestInit | undefined, token: string): Headers {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

/**
 * The credential for an `/api/*` or `/v1/*` request URL: the identity token (page origin
 * only) else the slot of the request's own origin. Null when no bearer covers it.
 */
function requestCredentials(url: string): { origin: string; slot: BearerSlot | null; token: string } | null {
  const origin = bearerTargetOrigin(url);
  if (!origin) return null;
  const slot = readSlot(origin);
  const token = (origin === pageOrigin() ? getAccessToken() : null) ?? slot?.token ?? null;
  return token ? { origin, slot, token } : null;
}

/**
 * Wrap `window.fetch` once so every API request carries the bearer of ITS OWN server
 * origin: the identity token (same-origin only) else that origin's slot — a bearer is
 * never sent to another origin (exact origin match). Idempotent: re-invocation is a
 * no-op. Never overrides an Authorization header a caller set explicitly. A request
 * authenticated with a slot's bearer also drives rotation and the `bearer_expired`
 * re-pair handling.
 */
export function installDeviceAuthFetch(): void {
  const w = window as unknown as { __piDeviceAuthFetch?: boolean };
  if (w.__piDeviceAuthFetch) return;
  w.__piDeviceAuthFetch = true;
  listenForSlotChanges();

  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    const creds = suppressBearer ? null : requestCredentials(url);
    if (!creds) return original(input, init);

    const headers = headersWithBearer(input, init, creds.token);
    // The slot this request authenticates with (null for an identity token / explicit foreign header).
    const used = creds.slot?.token && headers.get("Authorization") === `Bearer ${creds.slot.token}` ? creds.slot : null;
    if (used) maybeRotate(creds.origin, used, url);

    const res = await original(input, { ...init, headers });
    if (used && res.status === 401) void handleBearerExpired(res.clone(), creds.origin, used.token);
    return res;
  };
}

/**
 * Mint a fresh single-use WS ticket for `scope` using the stored bearer.
 * Returns null when this browser is unpaired (cookie/loopback auth path) or the
 * mint fails — callers fall back to opening the socket without a ticket.
 */
export async function mintWsTicket(
  scope: "browser" | "terminal" | "live" = "browser",
  opts: { probeCookie?: boolean } = {},
): Promise<string | null> {
  const token = getApiBearer();
  const marked = isDevicePaired();
  // probeCookie: no marker, but the device cookie may have been planted out of band
  // (Electron server window exchanges it from main). Try it once; mark on success.
  const cookieOnly = !token && (marked || opts.probeCookie === true);
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
    if (cookieOnly && marked && res.status === 401) setDevicePaired(false);
    const json = (await res.json()) as { success?: boolean; data?: { ticket?: string } };
    const ticket = json?.data?.ticket ?? null;
    if (cookieOnly && !marked && res.ok && ticket) setDevicePaired(true);
    return ticket;
  } catch {
    return null;
  }
}

/** Append `?ticket=<t>` (or `&ticket=`) to a WS url, preserving existing query. */
export function appendWsTicket(wsUrl: string, ticket: string): string {
  const sep = wsUrl.includes("?") ? "&" : "?";
  return `${wsUrl}${sep}ticket=${encodeURIComponent(ticket)}`;
}

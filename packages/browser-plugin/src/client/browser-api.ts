/**
 * Typed client for the browser plugin's REST surface (change:
 * add-browser-relay, task 4.1).
 *
 * Mirrors the server response shapes in
 * `packages/browser-plugin/src/server/routes.ts` (and `server/audit.ts`).
 * Types are duplicated here rather than imported: the client entry must never
 * pull the server subtree (node/child_process deps) into the browser bundle —
 * the same split `blackhole-plugin/src/client/pipeline-api.ts` takes.
 *
 * Relative `/api/browser/*` URLs: plugin clients resolve the API base at the
 * shell level, and every other plugin client uses relative paths.
 */
import type { BrowserRelayTabState } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

/** Web Store listing for the Playwright Chrome extension (mirrors server connect.ts). */
export const PLAYWRIGHT_EXTENSION_STORE_URL =
  "https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm";

const BASE = "/api/browser";

/** One tab as `GET /api/browser/profiles` reports it. */
interface BrowserRouteTab {
  tabId: number;
  title: string;
  url: string;
  state: BrowserRelayTabState;
  reason?: "devtools";
}

/** One live instance row (no guid ever leaves the server). */
export interface BrowserRouteInstance {
  instanceId: string;
  state: "connected" | "no-cdp-client";
  tabs: BrowserRouteTab[];
}

/** One Chrome profile row keyed by `profileDirectory`. */
export interface BrowserRouteProfile {
  profileDirectory: string;
  label: string;
  email?: string;
  installed: boolean;
  /** True when a pairing token is configured — the token itself never arrives. */
  hasToken: boolean;
  instances: BrowserRouteInstance[];
}

export interface BrowserProfilesResponse {
  profiles: Record<string, BrowserRouteProfile>;
  /** Set only on the synthetic-`Default` fallback; names the offending path. */
  warning?: string;
}

export interface BrowserStatusResponse {
  enabled: boolean;
  canOpenChrome: boolean;
}

type AuditKind =
  | "attach"
  | "detach"
  | "navigate"
  | "createTarget"
  | "denied"
  | "viewer-subscribe"
  | "viewer-input";

export interface AuditEntry {
  ts: number;
  profileDirectory: string;
  instanceId: string;
  kind: AuditKind;
  detail: string;
}

export interface BrowserAuditResponse {
  entries: AuditEntry[];
}

/** The plugin's persisted config (`plugins.browser.*`). */
export interface RelayConfig {
  enabled?: boolean;
  defaultBrowser?: string;
  allowMultipleInstancesPerProfile?: boolean;
  /** Per-profile config as the CLIENT sees it. `token` is `writeOnly` server-side
   * (stripped from every GET/broadcast) and MUST never be rendered. */
  browsers?: Record<string, { token?: string; zeroDialog?: boolean; allowedDomains?: string[] }>;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal });
  if (!res.ok) throw new Error(`GET ${BASE}${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export function getBrowserStatus(signal?: AbortSignal): Promise<BrowserStatusResponse> {
  return getJson<BrowserStatusResponse>("/status", signal);
}

export function getBrowserProfiles(signal?: AbortSignal): Promise<BrowserProfilesResponse> {
  return getJson<BrowserProfilesResponse>("/profiles", signal);
}

export function getBrowserAudit(
  profileDirectory: string,
  signal?: AbortSignal,
): Promise<BrowserAuditResponse> {
  return getJson<BrowserAuditResponse>(
    `/audit?profile=${encodeURIComponent(profileDirectory)}`,
    signal,
  );
}

export async function connectBrowserProfile(profileDirectory: string): Promise<void> {
  const res = await fetch(`${BASE}/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileDirectory }),
  });
  if (!res.ok) throw new Error(`connect failed: ${res.status}`);
}

export async function disconnectBrowserInstance(instanceId: string): Promise<void> {
  const res = await fetch(`${BASE}/disconnect?instanceId=${encodeURIComponent(instanceId)}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`disconnect failed: ${res.status}`);
}

export async function setBrowserEnabled(enabled: boolean): Promise<void> {
  const res = await fetch(`${BASE}/enabled`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(`PUT ${BASE}/enabled failed: ${res.status}`);
}

/** A per-profile config patch. `token: ""` clears it; omitted fields are untouched. */
export interface BrowserProfilePatch {
  token?: string;
  zeroDialog?: boolean;
  allowedDomains?: string[];
}

/**
 * Write ONE profile's config. Uses the plugin's own route (NOT the generic
 * `plugin_config_write`) because the server merges against the UNREDACTED
 * config — a redacted `browsers` round-trip through the client would drop every
 * other profile's writeOnly token on the server's shallow merge.
 */
export async function writeBrowserProfile(
  profileDirectory: string,
  patch: BrowserProfilePatch,
): Promise<{ hasToken: boolean }> {
  const res = await fetch(`${BASE}/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileDirectory, ...patch }),
  });
  if (!res.ok) throw new Error(`PUT ${BASE}/profile failed: ${res.status}`);
  return (await res.json()) as { hasToken: boolean };
}

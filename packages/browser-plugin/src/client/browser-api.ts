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
  reason?: "devtools" | "no-session";
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
  /** Display names of password-manager extensions installed in the profile (absent on an older server). */
  passwordManagers?: string[];
  instances: BrowserRouteInstance[];
}

/** One profile an operator host offers, with the instances the server knows on it. No token state. */
interface BrowserOperatorProfile {
  profileDirectory: string;
  label: string;
  email?: string;
  installed: boolean;
  instances: BrowserRouteInstance[];
}

/** One online operator computer (`GET /profiles` `operatorHosts[]`; absent on an older server). */
interface BrowserOperatorHost {
  hostId: string;
  label: string;
  platform: string;
  online: true;
  canOpenChrome: boolean;
  profiles: BrowserOperatorProfile[];
}

export interface BrowserProfilesResponse {
  profiles: Record<string, BrowserRouteProfile>;
  /** Online operator hosts; omitted by a server without operator-host support. */
  operatorHosts?: BrowserOperatorHost[];
  /** Set only on the synthetic-`Default` fallback; names the offending path. */
  warning?: string;
}

/** Lifecycle of the dashboard-owned Chrome profile (`status.dedicated.state`). */
export type DedicatedState = "not-created" | "stopped" | "starting" | "running";

/** Who holds the live dedicated instance: a pi session and/or a REST `client` label. */
export interface DedicatedHolder {
  sessionId?: string;
  client?: string;
}

/** `GET /status` `dedicated` block. Absent on a server without the dedicated browser. */
export interface DedicatedStatus {
  available: boolean;
  reason?: "no-chrome" | "no-display";
  state: DedicatedState;
  dataDir: string;
  downloadsDir: string;
  sizeBytes?: number;
  /** Epoch ms of the last client CDP command or `dedicated/open`. */
  lastUsed?: number;
  instanceId?: string;
  holder?: DedicatedHolder;
}

/** The "Agent browsing" settings (`PUT /api/browser/settings`), read back from `status.settings`. */
export interface AgentBrowsingSettings {
  /** `"@dedicated"` | `"@headless"` | a `profileDirectory`. */
  defaultBrowser: string;
  realProfile?: string;
  onUnavailable: "ask" | "next" | "stop";
  idleDisconnectMinutes: 0 | 5 | 30 | 120;
  allowMultipleInstancesPerProfile: boolean;
  openLiveViewOnConnect: boolean;
  allowedDomains: string[];
}

/** Partial body for `PUT /api/browser/settings`. */
export type BrowserSettingsPatch = Partial<AgentBrowsingSettings>;

export interface BrowserStatusResponse {
  enabled: boolean;
  canOpenChrome: boolean;
  /** Dedicated agent profile; absent on an older server (the panel then hides). */
  dedicated?: DedicatedStatus;
  /** Current Agent browsing values. When absent the client falls back to the plugin config. */
  settings?: Partial<AgentBrowsingSettings>;
  /** Literal `true` only on a server that supports operator hosts; clients send no `browser_host_*` without it. */
  operatorHosts?: true;
}

type AuditKind =
  | "attach"
  | "detach"
  | "navigate"
  | "createTarget"
  | "denied"
  | "dropped"
  | "open"
  | "viewer-subscribe"
  | "viewer-subscribe-refused"
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
  realProfile?: string;
  onUnavailable?: AgentBrowsingSettings["onUnavailable"];
  idleDisconnectMinutes?: AgentBrowsingSettings["idleDisconnectMinutes"];
  openLiveViewOnConnect?: boolean;
  allowedDomains?: string[];
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

/** Write the Agent browsing settings (partial). Rejects on 400 (invalid) or 403 (relay disabled). */
export async function putBrowserSettings(patch: BrowserSettingsPatch): Promise<void> {
  const res = await fetch(`${BASE}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`PUT ${BASE}/settings failed: ${res.status}`);
}

async function postDedicated(action: "open" | "stop" | "reset", body?: unknown): Promise<void> {
  const res = await fetch(`${BASE}/dedicated/${action}`, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`POST ${BASE}/dedicated/${action} failed: ${res.status}`);
}

/** "Open to sign in": opens a hidden server-owned sign-in tab (server default URL when omitted). */
export const openDedicated = (): Promise<void> => postDedicated("open", {});
export const stopDedicated = (): Promise<void> => postDedicated("stop");
export const resetDedicated = (): Promise<void> => postDedicated("reset");

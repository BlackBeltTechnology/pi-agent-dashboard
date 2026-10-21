/**
 * Dedicated deny set (change: add-dedicated-agent-browser, D5, spec
 * `dedicated-agent-browser` "Dedicated deny set").
 *
 * The dedicated profile is driven at BROWSER level over a pipe with no
 * extension in between, so the relay deny-list (`relay/deny-list.ts`, run first
 * by `DedicatedInstance`) is not enough. This module adds, for dedicated clients
 * only: a URL scheme allow-list, the denied-method set, a classification of every
 * `Browser`/`Target`/`Storage`/`Tethering`/`SystemInfo`/`Extensions` command, the
 * ack-and-drop list, the WebUI predicate and cookie scrubbing for forwarded
 * `Network` events. Everything here is pure; the instance owns the wiring.
 *
 * `METHOD_CLASSIFICATION` is the "classify every method" contract: a unit test
 * reads the `CommandParameters` keys of `playwright-core/types/protocol.d.ts` and
 * fails on any unclassified method, and anything unclassified (including a
 * synthetic `Target.fooBar`) is DENIED at runtime.
 */
import { ACK_AND_DROP_METHODS, deniedMethod } from "../relay/deny-list.js";

export type MethodClass =
  /** Forwarded to Chrome (after the deny checks); results/events may still be filtered. */
  | "allowed"
  /** Served by the proxy itself (locally, or forwarded with filtering) when sent browser-level. */
  | "proxy"
  | "denied";

/** Domains whose every method must be classified. */
export const CLASSIFIED_DOMAINS: readonly string[] = ["Browser", "Target", "Storage", "Tethering", "SystemInfo", "Extensions"];

/** Every command of `CLASSIFIED_DOMAINS` in playwright-core 1.62.1's protocol. */
export const METHOD_CLASSIFICATION: Readonly<Record<string, MethodClass>> = {
  // ── Browser ──
  "Browser.setPermission": "denied",
  "Browser.grantPermissions": "denied",
  "Browser.resetPermissions": "denied",
  "Browser.setDownloadBehavior": "proxy", // ack-and-drop
  "Browser.cancelDownload": "allowed",
  "Browser.close": "denied",
  "Browser.crash": "denied",
  "Browser.crashGpuProcess": "denied",
  "Browser.getVersion": "allowed",
  "Browser.getBrowserCommandLine": "denied",
  "Browser.getHistograms": "denied",
  "Browser.getHistogram": "denied",
  "Browser.getWindowBounds": "allowed",
  "Browser.getWindowForTarget": "allowed",
  "Browser.setWindowBounds": "allowed",
  "Browser.setContentsSize": "allowed",
  "Browser.setDockTile": "denied",
  "Browser.executeBrowserCommand": "denied",
  "Browser.addPrivacySandboxEnrollmentOverride": "denied",
  "Browser.addPrivacySandboxCoordinatorKeyConfig": "denied",
  // ── Extensions (all denied) ──
  "Extensions.triggerAction": "denied",
  "Extensions.loadUnpacked": "denied",
  "Extensions.getExtensions": "denied",
  "Extensions.uninstall": "denied",
  "Extensions.getStorageItems": "denied",
  "Extensions.removeStorageItems": "denied",
  "Extensions.clearStorageItems": "denied",
  "Extensions.setStorageItems": "denied",
  // ── Storage ──
  "Storage.getStorageKeyForFrame": "allowed",
  "Storage.getStorageKey": "allowed",
  "Storage.clearDataForOrigin": "denied",
  "Storage.clearDataForStorageKey": "denied",
  "Storage.getCookies": "denied",
  "Storage.setCookies": "denied",
  "Storage.clearCookies": "denied",
  "Storage.getUsageAndQuota": "allowed",
  "Storage.overrideQuotaForOrigin": "allowed",
  "Storage.trackCacheStorageForOrigin": "allowed",
  "Storage.trackCacheStorageForStorageKey": "allowed",
  "Storage.trackIndexedDBForOrigin": "allowed",
  "Storage.trackIndexedDBForStorageKey": "allowed",
  "Storage.untrackCacheStorageForOrigin": "allowed",
  "Storage.untrackCacheStorageForStorageKey": "allowed",
  "Storage.untrackIndexedDBForOrigin": "allowed",
  "Storage.untrackIndexedDBForStorageKey": "allowed",
  "Storage.getTrustTokens": "denied",
  "Storage.clearTrustTokens": "denied",
  "Storage.getInterestGroupDetails": "denied",
  "Storage.setInterestGroupTracking": "denied",
  "Storage.setInterestGroupAuctionTracking": "denied",
  "Storage.getSharedStorageMetadata": "allowed",
  "Storage.getSharedStorageEntries": "allowed",
  "Storage.setSharedStorageEntry": "denied",
  "Storage.deleteSharedStorageEntry": "denied",
  "Storage.clearSharedStorageEntries": "denied",
  "Storage.resetSharedStorageBudget": "denied",
  "Storage.setSharedStorageTracking": "denied",
  "Storage.setStorageBucketTracking": "allowed",
  "Storage.deleteStorageBucket": "denied",
  "Storage.runBounceTrackingMitigations": "denied",
  "Storage.getRelatedWebsiteSets": "allowed",
  "Storage.setProtectedAudienceKAnonymity": "denied",
  // ── SystemInfo (read-only) ──
  "SystemInfo.getInfo": "allowed",
  "SystemInfo.getFeatureState": "allowed",
  "SystemInfo.getProcessInfo": "allowed",
  // ── Target ──
  "Target.activateTarget": "allowed",
  "Target.attachToTarget": "proxy",
  "Target.attachToBrowserTarget": "denied",
  "Target.closeTarget": "allowed",
  "Target.exposeDevToolsProtocol": "denied",
  "Target.createBrowserContext": "proxy", // forwarded, refused for an ephemeral instance (add-gmail-auto-setup)
  "Target.getBrowserContexts": "allowed",
  "Target.createTarget": "allowed",
  "Target.detachFromTarget": "proxy",
  "Target.disposeBrowserContext": "proxy", // forwarded, refused for an ephemeral instance (add-gmail-auto-setup)
  "Target.getTargetInfo": "proxy",
  "Target.getTargets": "proxy",
  // Would let the client bypass every check by wrapping a command in a string.
  "Target.sendMessageToTarget": "denied",
  "Target.setAutoAttach": "proxy",
  "Target.autoAttachRelated": "denied",
  "Target.setDiscoverTargets": "proxy",
  "Target.setRemoteLocations": "denied",
  "Target.getDevToolsTarget": "denied",
  "Target.openDevTools": "denied",
  // ── Tethering (all denied) ──
  "Tethering.bind": "denied",
  "Tethering.unbind": "denied",
};

/**
 * Class of a method. A method in a classified domain that is not in the table is
 * `denied` (fail closed); a method of any other domain is `"unscoped"` (the generic
 * rules — cookie reads, URL policy, browser-level `Fetch`/`Network` — still apply).
 */
export function classifyMethod(method: string): MethodClass | "unscoped" {
  const domain = method.slice(0, method.indexOf("."));
  if (!CLASSIFIED_DOMAINS.includes(domain)) return "unscoped";
  return METHOD_CLASSIFICATION[method] ?? "denied";
}

/** Denied wherever they are sent (D5), independent of the table above. */
export const DEDICATED_DENIED_METHODS: readonly string[] = [
  "Target.attachToBrowserTarget",
  "Target.exposeDevToolsProtocol",
  "Browser.close",
  "Browser.crash",
  "Browser.crashGpuProcess",
  "Browser.setPermission",
  "Browser.grantPermissions",
  "Browser.resetPermissions",
  "Network.setCookie",
  "Network.setCookies",
  "Network.deleteCookies",
  "Network.clearBrowserCookies",
  "Storage.setCookies",
  "Storage.clearCookies",
];

/** Acknowledged with `{}`, never forwarded, audited as `dropped`. */
export const DEDICATED_ACK_AND_DROP_METHODS: readonly string[] = [...ACK_AND_DROP_METHODS, "Page.setDownloadBehavior"];

const WEBUI_PROTOCOLS: readonly string[] = ["chrome:", "chrome-untrusted:", "devtools:", "chrome-extension:"];

/** A privileged-page URL: such a target is hidden from agent clients. */
export function isWebUiUrl(url: unknown): boolean {
  if (typeof url !== "string") return false;
  try {
    return WEBUI_PROTOCOLS.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** `Page.navigate` / `Target.createTarget`: only `https:`, `http:` and exactly `about:blank`. */
export function navigationUrlAllowed(url: unknown): boolean {
  if (typeof url !== "string") return false;
  if (url === "about:blank") return true;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

const URL_METHODS: readonly string[] = ["Page.navigate", "Target.createTarget"];

export function isBlankNavigation(method: string, params: unknown): boolean {
  return (
    URL_METHODS.includes(method) &&
    typeof params === "object" &&
    params !== null &&
    (params as { url?: unknown }).url === "about:blank"
  );
}

/**
 * Dedicated-only denial. Returns the method name to report (error message and
 * audit detail) or `null` when the command may proceed. `sessionId` is the
 * client's, `undefined` for a browser-level command.
 */
export function dedicatedDenied(method: string, params: unknown, sessionId: string | undefined): string | null {
  if (classifyMethod(method) === "denied") return method;
  if (DEDICATED_DENIED_METHODS.includes(method)) return method;
  if (sessionId === undefined && (method.startsWith("Fetch.") || method.startsWith("Network."))) return method;
  if (URL_METHODS.includes(method)) {
    const url = typeof params === "object" && params !== null ? (params as { url?: unknown }).url : undefined;
    if (!navigationUrlAllowed(url)) return method;
  }
  return null;
}

/**
 * `dedicated/open {url}` check (spec: `https:` only and the effective allowed
 * domains; anything else is a 400). Reused by the route.
 */
export function checkOpenUrl(url: unknown, allowedDomains: readonly string[]): { ok: true } | { ok: false; reason: string } {
  if (typeof url !== "string") return { ok: false, reason: "url must be a string" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "url is not parseable" };
  }
  if (parsed.protocol !== "https:") return { ok: false, reason: "only https: urls are allowed" };
  if (deniedMethod("Page.navigate", { url }, allowedDomains) !== null) {
    return { ok: false, reason: "host is outside the allowed domains" };
  }
  return { ok: true };
}

// ── Cookie scrubbing (D5) ────────────────────────────────────────────────────

const COOKIE_HEADER = /^(?:cookie2?|set-cookie2?)$/i;
const COOKIE_ARRAY_FIELDS: ReadonlySet<string> = new Set(["associatedCookies", "blockedCookies", "exemptedCookies", "cookies"]);
const HEADERS_TEXT_KEY = /headerstext$/i;
const MAX_SCRUB_DEPTH = 8;

function scrubHeadersText(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:cookie2?|set-cookie2?)\s*:/i.test(line))
    .join("\r\n");
}

function isCookieHeaderEntry(el: unknown): boolean {
  if (!el || typeof el !== "object" || Array.isArray(el)) return false;
  const name = (el as { name?: unknown }).name;
  return typeof name === "string" && COOKIE_HEADER.test(name);
}

/** HeaderEntry arrays (`Fetch.requestPaused`): `[{name, value}]`. */
function scrubArray(node: unknown[], depth: number): void {
  for (let i = node.length - 1; i >= 0; i--) {
    if (isCookieHeaderEntry(node[i])) node.splice(i, 1);
    else scrub(node[i], depth + 1);
  }
}

function scrubObject(obj: Record<string, unknown>, depth: number): void {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (COOKIE_HEADER.test(key)) delete obj[key];
    else if (COOKIE_ARRAY_FIELDS.has(key) && Array.isArray(value)) obj[key] = []; // keep the type: a client that reads `.length` must not throw
    else if (HEADERS_TEXT_KEY.test(key) && typeof value === "string") obj[key] = scrubHeadersText(value);
    else scrub(value, depth + 1);
  }
}

function scrub(node: unknown, depth: number): void {
  if (depth > MAX_SCRUB_DEPTH || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) scrubArray(node, depth);
  else scrubObject(node as Record<string, unknown>, depth);
}

/** True for the events whose payload can carry cookie data. */
export function carriesCookies(method: string): boolean {
  return method.startsWith("Network.") || method === "Fetch.requestPaused";
}

/**
 * Remove `Cookie` / `Set-Cookie` headers (object keys, `{name,value}` entries and
 * raw header text lines) and the cookie arrays of the `*ExtraInfo` events from a
 * forwarded event, IN PLACE. Other headers are untouched.
 */
export function scrubCookies(params: unknown): void {
  scrub(params, 0);
}

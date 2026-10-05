// Runtime dashboard endpoint (change: extract-standalone-app-kit, design D2).
//
// One static SPA build targets any pi-dashboard host: the dashboard base URL is
// read at boot from a JSON document (`/config.json` by default) instead of being
// baked in. Every REST and WebSocket URL the kit builds resolves against it, and
// a credential (bearer, WS ticket) is only ever attached to a URL whose origin
// IS the dashboard origin — see `isDashboardOrigin`.

/** A machine-readable kit failure. `code` is stable; the message is not. */
export class AppKitError extends Error {
  constructor(
    readonly code: "invalid_dashboard_url" | "app_config_unavailable" | "no_page_origin",
    message: string = code,
  ) {
    super(message);
    this.name = "AppKitError";
  }
}

export interface AppConfig {
  /** Absolute `http(s)` base of the dashboard; absent or `""` = the page's own origin. */
  dashboardUrl?: string;
}

export interface LoadAppConfigOptions {
  /**
   * Dev-proxy mode: a `404` or a non-JSON body (an SPA fallback answering
   * `index.html`) means "same origin" instead of failing.
   */
  allowMissing?: boolean;
  fetchImpl?: typeof fetch;
}

/** The configured dashboard base, or `null` for the page's own origin. */
let dashboardBase: URL | null = null;

function parseDashboardUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppKitError("invalid_dashboard_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new AppKitError("invalid_dashboard_url");
  if (url.username || url.password) throw new AppKitError("invalid_dashboard_url");
  return url;
}

/**
 * Set the dashboard base directly. Throws `invalid_dashboard_url` for a
 * non-http(s) or userinfo-bearing URL and keeps the previous base.
 */
export function configureDashboard(config: AppConfig): void {
  const raw = config.dashboardUrl;
  dashboardBase = raw ? parseDashboardUrl(raw) : null;
}

/** Test-only: back to the page's own origin. */
export function resetAppConfig(): void {
  dashboardBase = null;
}

function pageOrigin(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  if (!origin || origin === "null") throw new AppKitError("no_page_origin");
  return origin;
}

function baseHref(): string {
  return dashboardBase ? dashboardBase.href : pageOrigin();
}

const ABSOLUTE = /^(https?|wss?):\/\//i;

/** Resolve a REST path against the dashboard base; an absolute URL passes through. */
export function apiUrl(path: string): string {
  if (ABSOLUTE.test(path)) return path;
  return new URL(path, baseHref()).href;
}

/** Resolve a socket path against the dashboard base (`http→ws`, `https→wss`); an absolute URL passes through. */
export function wsUrl(path: string): string {
  if (ABSOLUTE.test(path)) return path;
  const url = new URL(path, baseHref());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

/** The dashboard origin (`scheme://host:port`). */
export function dashboardOrigin(): string {
  return dashboardBase ? dashboardBase.origin : pageOrigin();
}

/**
 * True when `url` points at the dashboard origin — the only origin a bearer or
 * WS ticket may be sent to. `ws:`/`wss:` compare as `http:`/`https:`.
 */
export function isDashboardOrigin(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, baseHref());
  } catch {
    return false;
  }
  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  else if (parsed.protocol === "wss:") parsed.protocol = "https:";
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return parsed.origin === dashboardOrigin();
}

/**
 * Read `{ dashboardUrl }` from `url` (default `/config.json`, fetched from the
 * page's own origin, no cookies) and apply it with `configureDashboard`.
 */
export async function loadAppConfig(url = "/config.json", opts: LoadAppConfigOptions = {}): Promise<AppConfig> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  let text: string;
  try {
    res = await doFetch(url, { credentials: "omit", headers: { Accept: "application/json" } });
    text = await res.text();
  } catch {
    throw new AppKitError("app_config_unavailable");
  }
  const sameOrigin = (): AppConfig => {
    configureDashboard({});
    return {};
  };
  if (res.status === 404) {
    if (opts.allowMissing) return sameOrigin();
    throw new AppKitError("app_config_unavailable");
  }
  if (!res.ok) throw new AppKitError("app_config_unavailable");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    if (opts.allowMissing) return sameOrigin();
    throw new AppKitError("app_config_unavailable");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new AppKitError("app_config_unavailable");
  const dashboardUrl = (body as Record<string, unknown>).dashboardUrl;
  if (dashboardUrl === undefined || dashboardUrl === "") return sameOrigin();
  if (typeof dashboardUrl !== "string") throw new AppKitError("app_config_unavailable");
  configureDashboard({ dashboardUrl });
  return { dashboardUrl };
}

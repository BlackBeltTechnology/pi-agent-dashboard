/**
 * Structural contract of the `browser.dedicated` service the browser plugin
 * provides via `ctx.provide("browser.dedicated", …)` (design D2). Declared here,
 * not imported: the gmail plugin has no `dependsOn` on the browser plugin, so the
 * two meet only through this shape, resolved lazily with `ctx.consume`.
 * See change: add-gmail-auto-setup.
 */

export const BROWSER_DEDICATED_SERVICE = "browser.dedicated";

/** A refusal; `status` mirrors `POST /api/browser/dedicated/*`. */
export interface BrowserRefusal {
  ok: false;
  status: number;
  /** `busy`, `disabled`, `unloaded`, `no-chrome`, `no-display`, `owned-by-other-server`, `profile-in-use`, `launch-failed`, `url-denied`, … */
  reason: string;
  /** `busy` only: session id or client label of the holder. */
  holder?: string;
  /** `busy` only: the holder's instance id (kept server-side, never in a run view). */
  instanceId?: string;
  message?: string;
}

export interface DedicatedBrowserStatus {
  /** Plugin loaded AND kill switch on. */
  enabled: boolean;
  available: boolean;
  reason?: string;
  /** Server-chosen downloads dir of the dedicated profile (never `~/Downloads`). */
  downloadsDir: string;
  instanceId?: string;
  holder?: { sessionId?: string; client?: string };
}

export interface DedicatedConnectOptions {
  /** Holder label, e.g. `gmail-setup`. */
  client: string;
  /** Close the current holder and register atomically. */
  takeover?: boolean;
  /** Tabs excluded from `browser_relay_status`; viewer subscribe refused. */
  private?: boolean;
  /** Throwaway browser context discarded with the instance. */
  ephemeral?: boolean;
}

export interface DedicatedBrowserService {
  status(): Promise<DedicatedBrowserStatus>;
  connect(opts: DedicatedConnectOptions): Promise<{ ok: true; cdpUrl: string; instanceId: string } | BrowserRefusal>;
  /** Hidden, server-owned tab (in the instance's context when `instanceId` is given). `https:` + allowed domains only. */
  open(opts: { url: string; instanceId?: string }): Promise<{ ok: true; tabId: string } | BrowserRefusal>;
  focus(tabId: string): Promise<{ ok: true } | BrowserRefusal>;
  /** Origin only (`https://accounts.google.com`), or `null` once the tab is gone. */
  tabOrigin(tabId: string): Promise<string | null>;
  disconnect(instanceId: string): Promise<void>;
}

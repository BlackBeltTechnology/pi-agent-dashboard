/**
 * The in-process `browser.dedicated` service the plugin provides to other dashboard
 * plugins via `ctx.provide` (change: add-gmail-auto-setup, design D2). It is a thin
 * adapter over `RelayManager`: same kill switch, deny set and audit as the HTTP
 * routes, refusals returned as values (never thrown), and after `unload()` every
 * method refuses `{503, "unloaded"}`.
 *
 * The shape is declared structurally here (NOT imported from the gmail plugin, the
 * two plugins meet only through it); keep it in step with
 * `packages/gmail-plugin/src/server/setup/browser-service.ts`.
 */
import type { DedicatedStatusBody, RelayManager } from "./relay/relay-manager.js";

export const BROWSER_DEDICATED_SERVICE = "browser.dedicated";

export interface BrowserRefusal {
  ok: false;
  status: number;
  reason: string;
  holder?: string;
  instanceId?: string;
  message?: string;
}

export interface DedicatedBrowserStatus {
  /** Plugin loaded AND kill switch on. */
  enabled: boolean;
  available: boolean;
  reason?: string;
  downloadsDir: string;
  instanceId?: string;
  holder?: { sessionId?: string; client?: string };
}

export interface DedicatedConnectOptions {
  client: string;
  takeover?: boolean;
  private?: boolean;
  ephemeral?: boolean;
}

export interface DedicatedBrowserService {
  status(): Promise<DedicatedBrowserStatus>;
  connect(opts: DedicatedConnectOptions): Promise<{ ok: true; cdpUrl: string; instanceId: string } | BrowserRefusal>;
  open(opts: { url: string; instanceId?: string }): Promise<{ ok: true; tabId: string } | BrowserRefusal>;
  focus(tabId: string): Promise<{ ok: true } | BrowserRefusal>;
  tabOrigin(tabId: string): Promise<string | null>;
  disconnect(instanceId: string): Promise<void>;
}

type ServiceManager = Pick<
  RelayManager,
  | "enabled"
  | "connectDedicated"
  | "openDedicated"
  | "dedicatedStatus"
  | "dedicatedTabOrigin"
  | "focusDedicatedTab"
  | "disconnect"
>;

const UNLOADED: BrowserRefusal = { ok: false, status: 503, reason: "unloaded" };

export function createDedicatedService(manager: ServiceManager): DedicatedBrowserService & { unload(): void } {
  let unloaded = false;

  const refusal = (r: Omit<BrowserRefusal, "ok">): BrowserRefusal => ({
    ok: false,
    status: r.status,
    reason: r.reason,
    ...(r.holder !== undefined ? { holder: r.holder } : {}),
    ...(r.instanceId !== undefined ? { instanceId: r.instanceId } : {}),
    ...(r.message !== undefined ? { message: r.message } : {}),
  });

  return {
    unload: () => {
      unloaded = true;
    },

    async status() {
      if (unloaded) return { enabled: false, available: false, reason: "unloaded", downloadsDir: "" };
      const body: DedicatedStatusBody | undefined = await manager.dedicatedStatus();
      return {
        enabled: manager.enabled,
        available: body?.available ?? false,
        ...(body?.reason ? { reason: body.reason } : {}),
        downloadsDir: body?.downloadsDir ?? "",
        ...(body?.instanceId ? { instanceId: body.instanceId } : {}),
        ...(body?.holder ? { holder: { ...body.holder } } : {}),
      };
    },

    async connect(opts) {
      if (unloaded) return UNLOADED;
      const result = await manager.connectDedicated({
        client: opts.client,
        takeover: opts.takeover,
        private: opts.private,
        ephemeral: opts.ephemeral,
      });
      return result.ok ? { ok: true, cdpUrl: result.cdpUrl, instanceId: result.instanceId } : refusal(result);
    },

    async open(opts) {
      if (unloaded) return UNLOADED;
      const result = await manager.openDedicated(opts.url, opts.instanceId);
      return result.ok ? { ok: true, tabId: result.targetId } : refusal(result);
    },

    async focus(tabId) {
      if (unloaded) return UNLOADED;
      const result = await manager.focusDedicatedTab(tabId);
      return result.ok ? { ok: true } : refusal(result);
    },

    async tabOrigin(tabId) {
      return unloaded ? null : manager.dedicatedTabOrigin(tabId);
    },

    async disconnect(instanceId) {
      if (unloaded) return;
      manager.disconnect(instanceId);
    },
  };
}

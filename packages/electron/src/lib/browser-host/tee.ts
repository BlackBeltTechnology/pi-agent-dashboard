/**
 * Local frame tee. While a (link, tab) tee is on, every extension event that is
 * `Page.screencastFrame` for that tab's TOP-LEVEL target (`source.tabId === tabId`,
 * no `source.sessionId`) is copied to `onFrame` so the operator's own pane
 * renders without the server round trip. `observe` only reads: the caller still
 * forwards the original wire string to the server unchanged (the server acks).
 *
 * Wire shape of an extension event: `{method: "chrome.debugger.onEvent",
 * params: [{tabId, sessionId?}, cdpMethod, cdpParams]}`.
 *
 * Imports nothing from electron — unit-tested in `__tests__/tee.test.ts`.
 *
 * See change: add-operator-browser-relay (D10).
 */
import type { BrowserHostFrame } from "@blackbelt-technology/pi-dashboard-shared/browser-host-ipc.js";

const FRAME_NEEDLE = '"Page.screencastFrame"';
const EVENT_METHOD = "chrome.debugger.onEvent";

export interface Tee {
  /** Switch the copy for (link, tab) on or off. */
  set(linkId: string, instanceId: string, tabId: number, on: boolean): void;
  /** Stop every tee of a link (link closed). */
  drop(linkId: string): void;
  /** Inspect one extension → server message; never throws, never alters it. */
  observe(linkId: string, data: string): void;
}

interface CdpEvent {
  method?: unknown;
  params?: unknown;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function createTee(onFrame: (frame: BrowserHostFrame) => void): Tee {
  /** linkId → tabId → instanceId */
  const links = new Map<string, Map<number, string>>();

  return {
    set(linkId, instanceId, tabId, on) {
      if (!on) {
        const tabs = links.get(linkId);
        tabs?.delete(tabId);
        if (tabs?.size === 0) links.delete(linkId);
        return;
      }
      let tabs = links.get(linkId);
      if (!tabs) links.set(linkId, (tabs = new Map()));
      tabs.set(tabId, instanceId);
    },
    drop(linkId) {
      links.delete(linkId);
    },
    observe(linkId, data) {
      const tabs = links.get(linkId);
      if (!tabs || !data.includes(FRAME_NEEDLE)) return; // cheap pre-filter: skip JSON.parse for every other message
      try {
        const msg = JSON.parse(data) as CdpEvent;
        if (msg.method !== EVENT_METHOD || !Array.isArray(msg.params)) return;
        const [source, method, cdp] = msg.params as [{ tabId?: unknown; sessionId?: unknown }?, unknown?, { data?: unknown; metadata?: Record<string, unknown> }?];
        if (method !== "Page.screencastFrame" || typeof source?.tabId !== "number" || source.sessionId) return;
        const instanceId = tabs.get(source.tabId);
        if (instanceId === undefined || typeof cdp?.data !== "string") return;
        const m = cdp.metadata ?? {};
        onFrame({
          instanceId,
          tabId: source.tabId,
          jpegBase64: cdp.data,
          metadata: { deviceWidth: num(m.deviceWidth), deviceHeight: num(m.deviceHeight), timestamp: num(m.timestamp) },
        });
      } catch {
        /* malformed message: the server decides what to do with it */
      }
    },
  };
}

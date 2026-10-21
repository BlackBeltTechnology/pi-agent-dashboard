/**
 * Fake `browser.dedicated` service for the gmail setup tests: records every call,
 * can be busy (holder + instance id), refuse with a given reason, and scripts the
 * hidden sign-in tab's origin. See change: add-gmail-auto-setup.
 */
import type {
  BrowserRefusal,
  DedicatedBrowserService,
  DedicatedBrowserStatus,
  DedicatedConnectOptions,
} from "../server/setup/browser-service.js";

export interface FakeBrowserOptions {
  downloadsDir?: string;
  status?: Partial<DedicatedBrowserStatus>;
  /** `connect` without takeover answers `busy` with this holder until a takeover connect. */
  busyHolder?: string;
  /** `connect` always refuses with this reason. */
  refuse?: string;
  /** `cdpUrl` the connect answers with (default: a loopback socket). */
  cdpUrl?: string;
  /** Origin answers for the hidden sign-in tab, per `tabOrigin` call. */
  tabOrigin?: (call: number) => string | null;
}

export function fakeBrowserService(opts: FakeBrowserOptions = {}) {
  const calls = {
    connect: [] as DedicatedConnectOptions[],
    open: [] as Array<{ url: string; instanceId?: string }>,
    focus: [] as string[],
    tabOrigin: 0,
    disconnect: [] as string[],
  };
  let holderGone = false;
  let n = 0;
  const refusal = (reason: string, extra: Partial<BrowserRefusal> = {}): BrowserRefusal => ({
    ok: false,
    status: 409,
    reason,
    ...extra,
  });
  const service: DedicatedBrowserService = {
    async status() {
      return { enabled: true, available: true, downloadsDir: opts.downloadsDir ?? "/nonexistent", ...opts.status };
    },
    async connect(o) {
      calls.connect.push(o);
      if (opts.refuse) return refusal(opts.refuse);
      if (opts.busyHolder && !o.takeover && !holderGone) {
        return refusal("busy", { holder: opts.busyHolder, instanceId: "holder-instance-SECRET" });
      }
      if (o.takeover) holderGone = true;
      return { ok: true, cdpUrl: opts.cdpUrl ?? "ws://127.0.0.1:1/devtools/browser/fake", instanceId: `inst-${++n}` };
    },
    async open(o) {
      calls.open.push(o);
      return { ok: true, tabId: "tab-1" };
    },
    async focus(tabId) {
      calls.focus.push(tabId);
      return { ok: true };
    },
    async tabOrigin() {
      return (opts.tabOrigin ?? (() => "https://console.cloud.google.com"))(++calls.tabOrigin);
    },
    async disconnect(id) {
      calls.disconnect.push(id);
    },
  };
  return { service, calls };
}

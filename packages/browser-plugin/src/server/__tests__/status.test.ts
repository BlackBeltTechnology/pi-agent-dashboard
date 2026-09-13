/**
 * `browser_relay_status` broadcast + the three relay gateway handlers (change:
 * add-browser-relay, tasks 2.11 / 3.4 / 3.6; spec browser-relay "Viewer
 * subscribes", test-plan #E22, #P3, #X12).
 *
 * Pure unit tests: a stub `StatusManager` + stub `RelayLike`s so the composer,
 * the coalescer and the handler validation are exercised without a relay.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditRing } from "../audit.js";
import type { RelaySocket } from "../relay/extension-socket.js";
import type { RelayTabView } from "../relay/relay-instance.js";
import type { RelayLike } from "../relay/relay-manager.js";
import { BrowserRelayStatus, STATUS_COALESCE_MS, type StatusManager } from "../status.js";

class StubInstance implements RelayLike {
  readonly subscribed: Array<{ ws: RelaySocket; tabId: number }> = [];
  readonly unsubscribedAll: RelaySocket[] = [];
  readonly inputs: Array<{ tabId: number; msg: unknown; address?: string }> = [];
  private _tabs: RelayTabView[] = [];
  private _state: "connected" | "no-cdp-client" = "connected";

  constructor(
    readonly instanceId: string,
    readonly profileDirectory: string,
  ) {}

  setTabs(tabs: RelayTabView[]): void {
    this._tabs = tabs;
  }
  setState(state: "connected" | "no-cdp-client"): void {
    this._state = state;
  }
  tabList(): RelayTabView[] {
    return this._tabs;
  }
  statusState(): "connected" | "no-cdp-client" {
    return this._state;
  }
  subscribe(ws: RelaySocket, tabId: number): { ok: boolean } {
    this.subscribed.push({ ws, tabId });
    return { ok: true };
  }
  unsubscribe(ws: RelaySocket, tabId: number): void {
    this.subscribed.splice(
      this.subscribed.findIndex((s) => s.ws === ws && s.tabId === tabId),
      1,
    );
  }
  unsubscribeAll(ws: RelaySocket): void {
    this.unsubscribedAll.push(ws);
  }
  input(ws: RelaySocket, tabId: number, msg: unknown, address?: string): Promise<void> {
    this.inputs.push({ tabId, msg, address });
    return Promise.resolve();
  }
  close(): void {}
}

class StubManager implements StatusManager {
  readonly list: StubInstance[] = [];
  instances(): RelayLike[] {
    return this.list;
  }
  find(instanceId: string): RelayLike | undefined {
    return this.list.find((i) => i.instanceId === instanceId);
  }
}

interface Harness {
  status: BrowserRelayStatus;
  manager: StubManager;
  audit: AuditRing;
  broadcasts: Array<{ instances: unknown[]; auditSeq: number }>;
  handlers: Map<string, (msg: unknown, ws: unknown) => void>;
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
}

function harness(): Harness {
  const manager = new StubManager();
  const audit = new AuditRing();
  const broadcasts: Harness["broadcasts"] = [];
  const handlers = new Map<string, (msg: unknown, ws: unknown) => void>();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const status = new BrowserRelayStatus({
    manager,
    audit,
    logger,
    broadcast: (msg) => broadcasts.push(msg as never),
  });
  // Simulate `ctx.registerBrowserHandler` capturing the three handlers.
  const ctx = {
    registerBrowserHandler: (type: string, handler: (msg: unknown, ws: unknown) => void) =>
      handlers.set(type, handler),
    logger,
  } as unknown as ServerPluginContext;
  status.registerHandlers(ctx);
  return { status, manager, audit, broadcasts, handlers, logger };
}

/** A stub websocket with an `on` that records the close listener. */
function stubWs(): { ws: RelaySocket; close: () => void } {
  let closeListener: (() => void) | undefined;
  const ws = {
    readyState: 1,
    send() {},
    close() {},
    on(event: string, listener: () => void) {
      if (event === "close") closeListener = listener;
      return this;
    },
  } as unknown as RelaySocket;
  return { ws, close: () => closeListener?.() };
}

const invoke = (h: Harness, type: string, msg: unknown, ws: unknown) =>
  h.handlers.get(type)?.(msg, ws);

describe("BrowserRelayStatus.message", () => {
  it("composes instances + tabs + auditSeq, with no guid/token keys", () => {
    const h = harness();
    const inst = new StubInstance("inst-1", "Profile 1");
    inst.setTabs([
      { tabId: 5, title: "A", url: "https://a.test", state: "live" },
      { tabId: 9, title: "B", url: "https://b.test", state: "no-frames" },
    ]);
    h.manager.list.push(inst);

    const msg = h.status.message();
    expect(msg.type).toBe("browser_relay_status");
    expect(msg.instances).toEqual([
      {
        instanceId: "inst-1",
        profileDirectory: "Profile 1",
        state: "connected",
        tabs: [
          { tabId: 5, title: "A", url: "https://a.test", state: "live" },
          { tabId: 9, title: "B", url: "https://b.test", state: "no-frames" },
        ],
      },
    ]);
    expect(msg.auditSeq).toBe(0);
    const keys = JSON.stringify(msg);
    expect(keys).not.toContain("guid");
    expect(keys).not.toContain("token");
  });

  it("carries the devtools reason through from the tab view", () => {
    const h = harness();
    const inst = new StubInstance("inst-1", "P");
    inst.setTabs([{ tabId: 3, title: "", url: "", state: "detached", reason: "devtools" }]);
    h.manager.list.push(inst);
    expect(h.status.message().instances[0].tabs[0]).toEqual({
      tabId: 3,
      title: "",
      url: "",
      state: "detached",
      reason: "devtools",
    });
  });

  it("carries the no-cdp-client instance state", () => {
    const h = harness();
    const inst = new StubInstance("inst-1", "P");
    inst.setState("no-cdp-client");
    h.manager.list.push(inst);
    expect(h.status.message().instances[0].state).toBe("no-cdp-client");
  });
});

describe("BrowserRelayStatus coalescing (#P3)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("collapses 100 audit appends in 100 ms into ≤1 status, ending on the last seq", () => {
    const h = harness();
    for (let i = 0; i < 100; i++) h.audit.append({ profileDirectory: "P", instanceId: "i", kind: "denied", detail: "x" });
    // The appends scheduled exactly one broadcast.
    vi.advanceTimersByTime(STATUS_COALESCE_MS + 10);
    expect(h.broadcasts).toHaveLength(1);
    expect(h.broadcasts[0].auditSeq).toBe(100);
  });

  it("re-arms after a batch (a later append still broadcasts)", () => {
    const h = harness();
    h.audit.append({ profileDirectory: "P", instanceId: "i", kind: "denied", detail: "x" });
    vi.advanceTimersByTime(STATUS_COALESCE_MS + 10);
    h.audit.append({ profileDirectory: "P", instanceId: "i", kind: "denied", detail: "y" });
    vi.advanceTimersByTime(STATUS_COALESCE_MS + 10);
    expect(h.broadcasts.map((b) => b.auditSeq)).toEqual([1, 2]);
  });

  it("broadcastNow flushes immediately and cancels a pending coalesced emit", () => {
    const h = harness();
    h.audit.append({ profileDirectory: "P", instanceId: "i", kind: "denied", detail: "x" });
    h.status.broadcastNow();
    expect(h.broadcasts).toHaveLength(1);
    vi.advanceTimersByTime(STATUS_COALESCE_MS + 10);
    expect(h.broadcasts).toHaveLength(1);
  });
});

describe("relay gateway handlers (#3.6)", () => {
  it("registerHandlers registers all three message types", () => {
    const h = harness();
    expect([...h.handlers.keys()].sort()).toEqual([
      "browser_relay_input",
      "browser_relay_subscribe",
      "browser_relay_unsubscribe",
    ]);
  });

  it("subscribe routes a valid message to the resolved instance", () => {
    const h = harness();
    const inst = new StubInstance("inst-1", "P");
    h.manager.list.push(inst);
    const { ws } = stubWs();
    invoke(h, "browser_relay_subscribe", { instanceId: "inst-1", tabId: 7 }, ws);
    expect(inst.subscribed).toEqual([{ ws, tabId: 7 }]);
    expect(h.audit.list().some((e) => e.kind === "denied")).toBe(false);
  });

  it("subscribe to an unknown instance is denied + audited, never subscribed", () => {
    const h = harness();
    const inst = new StubInstance("inst-1", "P");
    h.manager.list.push(inst);
    const { ws } = stubWs();
    invoke(h, "browser_relay_subscribe", { instanceId: "nope", tabId: 7 }, ws);
    expect(inst.subscribed).toEqual([]);
    expect(h.audit.list()[0]).toMatchObject({ kind: "denied", detail: "browser_relay_subscribe" });
  });

  it.each([
    ["missing tabId", { instanceId: "inst-1" }],
    ["string tabId", { instanceId: "inst-1", tabId: "7" }],
    ["missing instanceId", { tabId: 7 }],
    ["non-object", "nonsense"],
  ])("subscribe with %s is ignored + audited", (_label, msg) => {
    const h = harness();
    const inst = new StubInstance("inst-1", "P");
    h.manager.list.push(inst);
    const { ws } = stubWs();
    invoke(h, "browser_relay_subscribe", msg, ws);
    expect(inst.subscribed).toEqual([]);
    expect(h.audit.list()[0]?.kind).toBe("denied");
  });

  it("input forwards to the instance with the socket's remote address", async () => {
    const h = harness();
    const inst = new StubInstance("inst-1", "P");
    h.manager.list.push(inst);
    const { ws } = stubWs();
    (ws as unknown as { _socket: { remoteAddress: string } })._socket = { remoteAddress: "127.0.0.1" };
    await invoke(h, "browser_relay_input", { instanceId: "inst-1", tabId: 7, kind: "mouse" }, ws);
    expect(inst.inputs).toEqual([{ tabId: 7, msg: { instanceId: "inst-1", tabId: 7, kind: "mouse" }, address: "127.0.0.1" }]);
  });

  it("input to an unknown instance is denied + audited and reaches no instance", () => {
    const h = harness();
    const inst = new StubInstance("inst-1", "P");
    h.manager.list.push(inst);
    const { ws } = stubWs();
    invoke(h, "browser_relay_input", { instanceId: "ghost", tabId: 7, kind: "mouse" }, ws);
    expect(inst.inputs).toEqual([]);
    expect(h.audit.list()[0]?.kind).toBe("denied");
  });

  it("a socket close unsubscribes it from every live instance", () => {
    const h = harness();
    const a = new StubInstance("a", "P");
    const b = new StubInstance("b", "P");
    h.manager.list.push(a, b);
    const { ws, close } = stubWs();
    invoke(h, "browser_relay_subscribe", { instanceId: "a", tabId: 1 }, ws);
    invoke(h, "browser_relay_subscribe", { instanceId: "b", tabId: 1 }, ws);
    close();
    expect(a.unsubscribedAll).toEqual([ws]);
    expect(b.unsubscribedAll).toEqual([ws]);
  });
});

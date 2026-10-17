/**
 * ScreencastTap direct tests (change: add-browser-relay) — test-plan #X13
 * (viewer drops mid-stream), #X8 (no-frames detector), #P1 (tap fps) and the
 * per-viewer backpressure rule, driven with a stub deps object so no sockets
 * or timers need mocking.
 */
import { describe, expect, it, vi } from "vitest";
import { AuditRing } from "../../audit.js";
import { ScreencastTap } from "../screencast-tap.js";
import { FakeSocket } from "./fake-socket.js";

interface Stub {
  tap: ScreencastTap;
  audit: AuditRing;
  sent: Array<{ sessionId: string; method: string; params: unknown }>;
  statusChanges: () => number;
  setClientScreencast: (v: boolean) => void;
}

function stub(noFramesMs = 5, tee?: { carrier: FakeSocket; linkId: string }): Stub {
  const audit = new AuditRing();
  const sent: Stub["sent"] = [];
  let statusChanges = 0;
  let clientScreencast = false;
  const tap = new ScreencastTap({
    profileDirectory: "Default",
    instanceId: "inst-1",
    audit,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    // Tab 7 always resolves; tab 8 is "detached" (no session).
    sessionIdForTab: (tabId) => (tabId === 7 ? "pw-tab-1" : undefined),
    sendToTab: async (sessionId, method, params) => {
      sent.push({ sessionId, method, params });
      return {};
    },
    clientScreencastActive: () => clientScreencast,
    onStatusChange: () => {
      statusChanges += 1;
    },
    noFramesMs,
    ...(tee ? { tee } : {}),
  });
  return {
    tap,
    audit,
    sent,
    statusChanges: () => statusChanges,
    setClientScreencast: (v) => {
      clientScreencast = v;
    },
  };
}

const frame = (data = "AAAA") => ({
  data,
  sessionId: 1,
  metadata: { deviceWidth: 1280, deviceHeight: 800, timestamp: 1 },
});

function frameCount(socket: FakeSocket): number {
  return socket.json().filter((m) => m.type === "browser_relay_frame").length;
}

describe("subscribe / unsubscribe (spec)", () => {
  it("starts the screencast once and stops it when the last viewer leaves", async () => {
    const s = stub();
    const a = new FakeSocket();
    const b = new FakeSocket();
    expect(s.tap.subscribe(a, 7).ok).toBe(true);
    expect(s.tap.subscribe(b, 7).ok).toBe(true);
    // One tap → one startScreencast, not one per viewer.
    expect(s.sent.filter((c) => c.method === "Page.startScreencast")).toHaveLength(1);

    s.tap.unsubscribe(a, 7);
    expect(s.sent.some((c) => c.method === "Page.stopScreencast")).toBe(false);
    s.tap.unsubscribe(b, 7);
    expect(s.sent.some((c) => c.method === "Page.stopScreencast")).toBe(true);
  });

  it("refuses a subscribe when the CDP client owns the screencast (E27)", () => {
    const s = stub();
    s.setClientScreencast(true);
    expect(s.tap.subscribe(new FakeSocket(), 7)).toEqual({
      ok: false,
      state: "client-screencast-active",
      reason: "client-screencast-active",
    });
  });

  it("refuses a subscribe for a tab with no live session (detached)", () => {
    const s = stub();
    expect(s.tap.subscribe(new FakeSocket(), 8)).toEqual({
      ok: false,
      state: "detached",
      reason: "no-session",
    });
  });

  it("audits viewer-subscribe with the tab id and no payload", () => {
    const s = stub();
    s.tap.subscribe(new FakeSocket(), 7);
    const entry = s.audit.list().find((e) => e.kind === "viewer-subscribe");
    expect(entry?.detail).toBe("tab:7");
  });
});

describe("frames", () => {
  it("routes a frame only to subscribers and acks it", () => {
    const s = stub();
    const viewer = new FakeSocket();
    const other = new FakeSocket();
    s.tap.subscribe(viewer, 7);

    const consumed = s.tap.onEvent("pw-tab-1", "Page.screencastFrame", frame("F1"));
    expect(consumed).toBe(true);
    expect(frameCount(viewer)).toBe(1);
    expect(frameCount(other)).toBe(0);
    expect(s.sent.some((c) => c.method === "Page.screencastFrameAck")).toBe(true);
  });

  it("ignores an event for a session it does not own (the client keeps it)", () => {
    const s = stub();
    s.tap.subscribe(new FakeSocket(), 7);
    expect(s.tap.onEvent("pw-tab-9", "Page.screencastFrame", frame())).toBe(false);
    expect(s.tap.onEvent("pw-tab-1", "Runtime.consoleAPICalled", {})).toBe(false);
  });

  it("skips frames only for the viewer over the backpressure threshold (P2)", () => {
    const s = stub();
    const slow = new FakeSocket();
    slow.bufferedAmount = 600 * 1024;
    const fast = new FakeSocket();
    s.tap.subscribe(slow, 7);
    s.tap.subscribe(fast, 7);

    s.tap.onEvent("pw-tab-1", "Page.screencastFrame", frame());
    expect(frameCount(slow)).toBe(0);
    expect(frameCount(fast)).toBe(1);
    expect(s.tap.skippedFor(7, slow)).toBe(1);
    // The ack still goes out for every frame, whatever the viewers are doing.
    expect(s.sent.some((c) => c.method === "Page.screencastFrameAck")).toBe(true);
  });

  it("keeps streaming to the surviving viewer when a peer socket drops (X13)", () => {
    const s = stub();
    const a = new FakeSocket();
    const b = new FakeSocket();
    s.tap.subscribe(a, 7);
    s.tap.subscribe(b, 7);

    s.tap.onEvent("pw-tab-1", "Page.screencastFrame", frame());
    expect(frameCount(b)).toBe(1);

    // Simulate the socket dropping: the host calls unsubscribeAll on close.
    s.tap.unsubscribeAll(a);
    expect(s.sent.some((c) => c.method === "Page.stopScreencast")).toBe(false);

    s.tap.onEvent("pw-tab-1", "Page.screencastFrame", frame());
    expect(frameCount(b)).toBe(2);

    s.tap.unsubscribeAll(b);
    expect(s.sent.some((c) => c.method === "Page.stopScreencast")).toBe(true);
  });

  it("sustains at least 8 frames/s with a stubbed 10 fps source (P1)", async () => {
    const s = stub();
    const viewer = new FakeSocket();
    s.tap.subscribe(viewer, 7);
    for (let i = 0; i < 10; i++) {
      s.tap.onEvent("pw-tab-1", "Page.screencastFrame", frame());
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(frameCount(viewer)).toBe(10);
  });
});

describe("no-frames detector (X8)", () => {
  it("marks a tab no-frames after the idle window and back to live on the next frame", async () => {
    const s = stub(5);
    const viewer = new FakeSocket();
    s.tap.subscribe(viewer, 7);
    expect(s.tap.tabStates().get(7)).toBe("no-frames");

    s.tap.onEvent("pw-tab-1", "Page.screencastFrame", frame());
    expect(s.tap.tabStates().get(7)).toBe("live");

    await new Promise((r) => setTimeout(r, 25));
    expect(s.tap.tabStates().get(7)).toBe("no-frames");

    s.tap.onEvent("pw-tab-1", "Page.screencastFrame", frame());
    expect(s.tap.tabStates().get(7)).toBe("live");
  });

  it("notifies status on the no-frames transition (the tile overlay depends on it)", async () => {
    const s = stub(5);
    s.tap.subscribe(new FakeSocket(), 7);
    s.tap.onEvent("pw-tab-1", "Page.screencastFrame", frame());
    const before = s.statusChanges();
    await new Promise((r) => setTimeout(r, 25));
    expect(s.statusChanges()).toBeGreaterThan(before);
  });
});

describe("teardown", () => {
  it("closeAll stops every screencast and clears viewers", () => {
    const s = stub();
    s.tap.subscribe(new FakeSocket(), 7);
    s.tap.closeAll();
    expect(s.tap.tabIds).toEqual([]);
    expect(s.sent.filter((c) => c.method === "Page.stopScreencast")).toHaveLength(1);
  });

  it("handlesSession is false once the last viewer leaves (client frames resume)", () => {
    const s = stub();
    const viewer = new FakeSocket();
    s.tap.subscribe(viewer, 7);
    expect(s.tap.handlesSession("pw-tab-1")).toBe(true);
    s.tap.unsubscribe(viewer, 7);
    expect(s.tap.handlesSession("pw-tab-1")).toBe(false);
  });

  it("input from a non-subscriber is ignored entirely", async () => {
    const s = stub();
    const spy = vi.fn();
    // No subscribe → the viewer is not tracked.
    await s.tap.input(new FakeSocket(), 7, { kind: "bringToFront" });
    expect(spy).not.toHaveBeenCalled();
    expect(s.sent).toHaveLength(0);
  });
});

/**
 * Local frame viewers (change: add-operator-browser-relay, task 7.6, design
 * D10) — test-plan #E25–#E28. The carrier is the viewer socket the instance's
 * link rides on; it renders frames from its own tee instead of receiving them.
 */
describe("local viewers (D10)", () => {
  const LINK = "l".repeat(32);
  const tees = (socket: FakeSocket) => socket.json().filter((m) => m.type === "browser_host_tee");
  const acks = (s: Stub) => s.sent.filter((c) => c.method === "Page.screencastFrameAck");

  function withCarrier() {
    const carrier = new FakeSocket();
    return { carrier, s: stub(5, { carrier, linkId: LINK }) };
  }

  it("carrier subscribes local: tee on, no browser_relay_frame, frames still acked, screencast running (E25)", () => {
    const { carrier, s } = withCarrier();
    expect(s.tap.subscribe(carrier, 7, { local: true }).ok).toBe(true);
    expect(tees(carrier)).toEqual([
      { type: "browser_host_tee", linkId: LINK, instanceId: "inst-1", tabId: 7, on: true },
    ]);
    expect(s.sent.filter((c) => c.method === "Page.startScreencast")).toHaveLength(1);
    for (let i = 0; i < 3; i++) s.tap.onEvent("pw-tab-1", "Page.screencastFrame", frame());
    expect(frameCount(carrier)).toBe(0);
    expect(acks(s)).toHaveLength(3);
    expect(s.tap.handlesSession("pw-tab-1")).toBe(true);
  });

  it("another socket's local:true is a normal subscribe + audited local-ignored (E26)", () => {
    const { s } = withCarrier();
    const phone = new FakeSocket();
    expect(s.tap.subscribe(phone, 7, { local: true }).ok).toBe(true);
    for (let i = 0; i < 3; i++) s.tap.onEvent("pw-tab-1", "Page.screencastFrame", frame());
    expect(frameCount(phone)).toBe(3);
    expect(tees(phone)).toHaveLength(0);
    const denied = s.audit.list().filter((e) => e.kind === "denied");
    expect(denied.map((e) => e.detail)).toEqual(["browser_host:local-ignored"]);
  });

  it("local:true on an instance with no carrier is ignored the same way", () => {
    const s = stub();
    const viewer = new FakeSocket();
    s.tap.subscribe(viewer, 7, { local: true });
    s.tap.onEvent("pw-tab-1", "Page.screencastFrame", frame());
    expect(frameCount(viewer)).toBe(1);
    expect(s.audit.list().some((e) => e.detail === "browser_host:local-ignored")).toBe(true);
  });

  it("local → non-local on the same tab: tee off first, then frames; never both for one frame (E27)", () => {
    const { carrier, s } = withCarrier();
    s.tap.subscribe(carrier, 7, { local: true });
    s.tap.onEvent("pw-tab-1", "Page.screencastFrame", frame());
    expect(frameCount(carrier)).toBe(0);

    s.tap.subscribe(carrier, 7);
    s.tap.onEvent("pw-tab-1", "Page.screencastFrame", frame());
    const order = carrier.json().map((m) => (m.type === "browser_host_tee" ? `tee:${m.on}` : m.type));
    expect(order).toEqual(["tee:true", "tee:false", "browser_relay_frame"]);
    // one subscription per (socket, tab): still a single start
    expect(s.sent.filter((c) => c.method === "Page.startScreencast")).toHaveLength(1);
  });

  it("non-local → local: tee on, frames stop", () => {
    const { carrier, s } = withCarrier();
    s.tap.subscribe(carrier, 7);
    s.tap.onEvent("pw-tab-1", "Page.screencastFrame", frame());
    expect(frameCount(carrier)).toBe(1);
    s.tap.subscribe(carrier, 7, { local: true });
    s.tap.onEvent("pw-tab-1", "Page.screencastFrame", frame());
    expect(frameCount(carrier)).toBe(1);
    expect(tees(carrier).map((m) => m.on)).toEqual([true]);
  });

  it("a repeated local subscribe does not resend tee", () => {
    const { carrier, s } = withCarrier();
    s.tap.subscribe(carrier, 7, { local: true });
    s.tap.subscribe(carrier, 7, { local: true });
    expect(tees(carrier)).toHaveLength(1);
  });

  it("last local viewer unsubscribes: tee off sent and the screencast stops (E28)", () => {
    const { carrier, s } = withCarrier();
    s.tap.subscribe(carrier, 7, { local: true });
    s.tap.unsubscribe(carrier, 7);
    expect(tees(carrier).map((m) => m.on)).toEqual([true, false]);
    expect(s.sent.some((c) => c.method === "Page.stopScreencast")).toBe(true);
    expect(s.tap.tabIds).toEqual([]);
  });

  it("a local viewer keeps the screencast alive for a remote one and vice versa", () => {
    const { carrier, s } = withCarrier();
    const phone = new FakeSocket();
    s.tap.subscribe(carrier, 7, { local: true });
    s.tap.subscribe(phone, 7);
    s.tap.unsubscribe(phone, 7);
    expect(s.sent.some((c) => c.method === "Page.stopScreencast")).toBe(false);
    s.tap.unsubscribe(carrier, 7);
    expect(s.sent.some((c) => c.method === "Page.stopScreencast")).toBe(true);
  });

  it("carrier close (unsubscribeAll) sends no tee to a closed socket and stops the tab", () => {
    const { carrier, s } = withCarrier();
    s.tap.subscribe(carrier, 7, { local: true });
    carrier.readyState = 3;
    s.tap.unsubscribeAll(carrier);
    expect(tees(carrier).map((m) => m.on)).toEqual([true]);
    expect(s.tap.tabIds).toEqual([]);
  });

  it("a refused subscribe (client owns the screencast) never tees", () => {
    const { s } = withCarrier();
    s.setClientScreencast(true);
    const phone = new FakeSocket();
    expect(s.tap.subscribe(phone, 7, { local: true }).ok).toBe(false);
    expect(tees(phone)).toHaveLength(0);
  });
});

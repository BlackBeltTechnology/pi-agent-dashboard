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

function stub(noFramesMs = 5): Stub {
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

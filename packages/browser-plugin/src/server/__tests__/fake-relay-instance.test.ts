/**
 * `FakeRelayInstance` (change: add-browser-relay, task 2.10b / test-plan #E28).
 * Deterministic fake timers — the harness relies on this instance emitting
 * frames without a real Chrome.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditRing } from "../audit.js";
import { viewerSocket } from "../relay/__tests__/fake-socket.js";
import { FAKE_FRAME_INTERVAL_MS, FakeRelayInstance } from "../relay/fake-relay-instance.js";
import type { RelayTimers } from "../relay/relay-instance.js";

const timers: RelayTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as never),
};
const logger = { info: () => {}, warn: () => {}, error: () => {} };

function make(audit = new AuditRing()): FakeRelayInstance {
  return new FakeRelayInstance({ instanceId: "fake-1", audit, logger, timers });
}

afterEach(() => vi.useRealTimers());

describe("FakeRelayInstance (#E28)", () => {
  it("lists one tab and reports connected", () => {
    const inst = make();
    expect(inst.tabList()).toEqual([{ tabId: 1, title: "Fake tab", url: "https://fake.test/", state: "live" }]);
    expect(inst.statusState()).toBe("connected");
    inst.close("done");
  });

  it("sends one immediate frame, then >=5 frames/s to a subscriber", () => {
    vi.useFakeTimers();
    const inst = make();
    const viewer = viewerSocket();
    expect(inst.subscribe(viewer, 1)).toEqual({ ok: true });
    expect(viewer.frames()).toHaveLength(1);
    vi.advanceTimersByTime(FAKE_FRAME_INTERVAL_MS * 5);
    // 1 immediate + 5 ticks over one second.
    expect(viewer.frames().length).toBeGreaterThanOrEqual(5);
    inst.close("done");
  });

  it("refuses a tab it does not own", () => {
    const inst = make();
    expect(inst.subscribe(viewerSocket(), 2)).toMatchObject({ ok: false, state: "detached" });
    inst.close("done");
  });

  it("echoes viewer input into the audit and goes silent after close", () => {
    vi.useFakeTimers();
    const audit = new AuditRing();
    const inst = make(audit);
    const viewer = viewerSocket();
    inst.subscribe(viewer, 1);
    void inst.input(viewer, 1, { kind: "bringToFront" });
    expect(audit.list().some((e) => e.kind === "viewer-input" && e.detail === "bringToFront")).toBe(true);

    inst.close("done");
    const before = viewer.frames().length;
    vi.advanceTimersByTime(FAKE_FRAME_INTERVAL_MS * 3);
    expect(viewer.frames().length).toBe(before);
  });

  it("audits a malformed input as denied", () => {
    const audit = new AuditRing();
    const inst = make(audit);
    void inst.input(viewerSocket(), 1, {});
    expect(audit.list()[0]).toMatchObject({ kind: "denied", detail: "unknown" });
    inst.close("done");
  });
});

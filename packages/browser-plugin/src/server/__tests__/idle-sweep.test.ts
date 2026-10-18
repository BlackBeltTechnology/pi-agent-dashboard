/** `IdleSweeper` (task 6.3, #R15 #R16). See change: add-dedicated-agent-browser. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditRing } from "../audit.js";
import { IDLE_SWEEP_INTERVAL_MS, IdleSweeper } from "../idle-sweep.js";

const MIN = 60_000;

function setup(o: { minutes?: number; enabled?: boolean; pending?: (id: string) => boolean } = {}) {
  const audit = new AuditRing();
  const state = {
    minutes: o.minutes ?? 5,
    enabled: o.enabled ?? true,
    last: new Map<string, number>([["i1", Date.now()]]),
    registered: new Set(["i1"]),
    pending: o.pending ?? (() => false),
  };
  const close = vi.fn((id: string, _reason: "idle") => {
    state.registered.delete(id);
  });
  const sweeper = new IdleSweeper({
    enabled: () => state.enabled,
    idleMinutes: () => state.minutes,
    instances: () => [...state.registered].map((instanceId) => ({ instanceId, profileDirectory: "@dedicated" })),
    activityOf: (id) => state.last.get(id),
    awaitPending: (id) => state.pending(id),
    isRegistered: (id) => state.registered.has(id),
    close,
    audit,
  });
  return { sweeper, state, close, audit };
}

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

describe("#R15 idle disconnect (BVA)", () => {
  it("still connected at 4:59 idle; closed with detach `idle` after the sweep following 5 min", () => {
    const s = setup();
    s.sweeper.start();
    vi.advanceTimersByTime(4 * MIN + 59_000); // 4:59 idle
    expect(s.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000); // 5:00 sweep — exactly 5 min is not "longer than"
    expect(s.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MIN); // next sweep → idle > 5 min
    expect(s.close).toHaveBeenCalledWith("i1", "idle");
    expect(s.audit.list().map((e) => `${e.kind}:${e.detail}:${e.instanceId}`)).toEqual(["detach:idle:i1"]);
    s.sweeper.stop();
  });

  it("a client command resets the clock", () => {
    const s = setup();
    s.sweeper.start();
    vi.advanceTimersByTime(4 * MIN);
    s.state.last.set("i1", Date.now());
    vi.advanceTimersByTime(4 * MIN);
    expect(s.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2 * MIN);
    expect(s.close).toHaveBeenCalledTimes(1);
  });

  it("no recorded activity: the idle clock starts when the sweeper first sees the instance", () => {
    const s = setup();
    s.state.last.clear();
    s.sweeper.start();
    vi.advanceTimersByTime(5 * MIN);
    expect(s.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2 * MIN);
    expect(s.close).toHaveBeenCalledTimes(1);
  });
});

describe("#R16 holds", () => {
  it("(a) pending browser_await_human for 10 min holds; the idle clock restarts when it ends", () => {
    let pending = true;
    const s = setup({ pending: () => pending });
    s.sweeper.start();
    vi.advanceTimersByTime(10 * MIN);
    expect(s.close).not.toHaveBeenCalled();
    pending = false;
    vi.advanceTimersByTime(4 * MIN);
    expect(s.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3 * MIN);
    expect(s.close).toHaveBeenCalledTimes(1);
  });

  it("(b) viewer input every 2 min keeps it alive", () => {
    const s = setup();
    s.sweeper.start();
    for (let i = 0; i < 15; i++) {
      vi.advanceTimersByTime(2 * MIN);
      s.state.last.set("i1", Date.now());
    }
    expect(s.close).not.toHaveBeenCalled();
  });

  it("(c) idleDisconnectMinutes 0 never closes (3 h)", () => {
    const s = setup({ minutes: 0 });
    s.sweeper.start();
    vi.advanceTimersByTime(180 * MIN);
    expect(s.close).not.toHaveBeenCalled();
  });

  it("(d) plugin disabled: sweep is a no-op", () => {
    const s = setup({ enabled: false });
    s.sweeper.start();
    vi.advanceTimersByTime(60 * MIN);
    expect(s.close).not.toHaveBeenCalled();
    expect(s.audit.list()).toEqual([]);
  });
});

describe("sweep mechanics", () => {
  it("re-checks registration right before closing (an instance gone since listing is skipped, nothing audited)", () => {
    const s = setup();
    const audit = new AuditRing();
    const close = vi.fn();
    const sw = new IdleSweeper({
      enabled: () => true,
      idleMinutes: () => 1,
      instances: () => [{ instanceId: "i1", profileDirectory: "P" }],
      activityOf: () => 0,
      awaitPending: () => false,
      isRegistered: () => false,
      close,
      audit,
    });
    sw.sweep();
    expect(close).not.toHaveBeenCalled();
    expect(audit.list()).toEqual([]);
    void s;
  });

  it("a throwing close does not stop the other instances nor audit a detach", () => {
    const audit = new AuditRing();
    const close = vi.fn((id: string) => {
      if (id === "a") throw new Error("boom");
    });
    const sw = new IdleSweeper({
      enabled: () => true,
      idleMinutes: () => 1,
      instances: () => [{ instanceId: "a", profileDirectory: "P" }, { instanceId: "b", profileDirectory: "P" }],
      activityOf: () => 0,
      awaitPending: () => false,
      isRegistered: () => true,
      close,
      audit,
    });
    sw.sweep();
    expect(close).toHaveBeenCalledTimes(2);
    expect(audit.list().map((e) => e.instanceId)).toEqual(["b"]);
  });

  it("start is idempotent and stop clears the interval; bookkeeping is pruned for gone instances", () => {
    const s = setup();
    s.sweeper.start();
    s.sweeper.start();
    expect(vi.getTimerCount()).toBe(1);
    s.state.last.clear();
    s.sweeper.sweep();
    expect(s.sweeper.trackedSize).toBe(1);
    s.state.registered.clear();
    s.sweeper.sweep();
    expect(s.sweeper.trackedSize).toBe(0);
    s.sweeper.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

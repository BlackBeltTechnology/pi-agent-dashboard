/**
 * Follow-glide controller + pin planner (tasks 6.2, 6.4; test-plan #E26–#E28,
 * #E32). Fake timers drive both `performance.now` and rAF.
 * Harness glue copied from `hooks/__tests__/useIdleFx.test.tsx`.
 * See change: add-fluid-chat-motion (D6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FollowGlide, GLIDE_SNAP_PX, planBottomPin } from "../follow-glide.js";

interface FakeEl {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

function harness(el: FakeEl, extra: { blocked?: () => boolean } = {}) {
  const writes: number[] = [];
  const busy: boolean[] = [];
  const glide = new FollowGlide({
    getEl: () => el as unknown as HTMLElement,
    isBlocked: extra.blocked ?? (() => false),
    beforeWrite: () => {},
    afterWrite: (a) => writes.push(a.top),
    onBusyChange: (b) => busy.push(b),
  });
  return { glide, writes, busy };
}

/** Run the glide on a rAF that fires every `frameMs`, returning ms until it settles. */
function settleTime(delta: number, clientHeight: number, frameMs: number): number {
  const el: FakeEl = { scrollTop: 0, scrollHeight: clientHeight + delta, clientHeight };
  const { glide } = harness(el);
  const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => setTimeout(() => cb(performance.now()), frameMs) as unknown as number);
  const caf = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => clearTimeout(id as never));
  glide.start();
  let elapsed = 0;
  while (glide.isActive() && elapsed < 2000) {
    vi.advanceTimersByTime(frameMs);
    elapsed += frameMs;
  }
  expect(el.scrollTop).toBe(delta); // landed exactly on the bottom
  raf.mockRestore();
  caf.mockRestore();
  return elapsed;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("FollowGlide", () => {
  it("settles ≤ 500 ms for Δ = clientHeight, alike at 60 Hz and 120 Hz (E27)", () => {
    const at60 = settleTime(600, 600, 1000 / 60);
    const at120 = settleTime(600, 600, 1000 / 120);
    expect(at60).toBeLessThanOrEqual(500);
    expect(at120).toBeLessThanOrEqual(500);
    // Frame-rate independent: settle times differ by about one 60 Hz frame.
    expect(Math.abs(at60 - at120)).toBeLessThanOrEqual(17);
  });

  it("moves in intermediate steps, then snaps within 2 px of the bottom", () => {
    const el: FakeEl = { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 };
    const { glide, writes } = harness(el);
    glide.start();
    vi.advanceTimersByTime(1000);
    expect(writes.length).toBeGreaterThanOrEqual(3);
    expect(writes[0]).toBeGreaterThan(0);
    expect(writes[0]).toBeLessThan(600);
    expect(writes.at(-1)).toBe(600);
    expect(GLIDE_SNAP_PX).toBe(2);
  });

  it("re-targets each frame: growth mid-glide extends the chase", () => {
    const el: FakeEl = { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 };
    const { glide } = harness(el);
    glide.start();
    vi.advanceTimersByTime(64);
    el.scrollHeight = 1400; // new content while gliding
    vi.advanceTimersByTime(1000);
    expect(el.scrollTop).toBe(1000);
  });

  it("schedules no frame at rest and reports busy only while chasing (E32)", () => {
    const el: FakeEl = { scrollTop: 590, scrollHeight: 1000, clientHeight: 400 };
    const { glide, busy } = harness(el);
    glide.start();
    vi.advanceTimersByTime(1000);
    expect(glide.isActive()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(busy).toEqual([true, false]);
    vi.advanceTimersByTime(10_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancel stops the chase with no further writes", () => {
    const el: FakeEl = { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 };
    const { glide, writes } = harness(el);
    glide.start();
    vi.advanceTimersByTime(32);
    const n = writes.length;
    glide.cancel();
    vi.advanceTimersByTime(1000);
    expect(writes.length).toBe(n);
    expect(glide.isActive()).toBe(false);
  });

  it("a blocked step (selection, motion off, follow released) ends the glide without writing", () => {
    const el: FakeEl = { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 };
    let blocked = false;
    const { glide, writes } = harness(el, { blocked: () => blocked });
    glide.start();
    vi.advanceTimersByTime(32);
    const n = writes.length;
    blocked = true;
    vi.advanceTimersByTime(1000);
    expect(writes.length).toBe(n);
    expect(glide.isActive()).toBe(false);
  });
});

describe("planBottomPin", () => {
  const base = { kind: "live", glideAllowed: true, guardsPass: true, glideActive: false, remaining: 100, clientHeight: 600 } as const;

  it("live: glides at remaining = clientHeight (600), instant at 601 (E26)", () => {
    expect(planBottomPin({ ...base, remaining: 600 })).toBe("glide");
    expect(planBottomPin({ ...base, remaining: 601 })).toBe("instant");
  });

  it("live: instant when not allowed, or when nothing meaningful is left to chase", () => {
    expect(planBottomPin({ ...base, glideAllowed: false })).toBe("instant");
    expect(planBottomPin({ ...base, remaining: 1 })).toBe("instant");
    expect(planBottomPin({ ...base, remaining: 1, glideActive: true })).toBe("glide");
  });

  it("measure: re-targets an in-flight glide only when guards pass and remaining ≤ clientHeight (E28)", () => {
    const m = { ...base, kind: "measure", glideActive: true } as const;
    expect(planBottomPin({ ...m, guardsPass: false })).toBe("instant"); // (a) splice suppression on
    expect(planBottomPin({ ...m, remaining: 601 })).toBe("instant"); // (b) too far
    expect(planBottomPin({ ...m, remaining: 300 })).toBe("glide"); // (c) re-target, no write
    // No glide in flight: today's instant write, except inside a live growth commit.
    expect(planBottomPin({ ...m, glideActive: false, glideAllowed: false })).toBe("instant");
    expect(planBottomPin({ ...m, glideActive: false, glideAllowed: true, remaining: 90 })).toBe("glide");
    expect(planBottomPin({ ...m, glideActive: false, glideAllowed: true, remaining: 601 })).toBe("instant");
    expect(planBottomPin({ ...m, glideActive: false, glideAllowed: true, guardsPass: false })).toBe("instant");
  });
});

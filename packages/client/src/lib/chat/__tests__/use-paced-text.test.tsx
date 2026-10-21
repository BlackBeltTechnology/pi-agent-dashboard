/**
 * `usePacedText` — fake-timer unit coverage for every rule of the paced reveal
 * (tasks 4.1, 4.5–4.9, 4.11, 4.12; test-plan #E16–#E23). Fake timers fake both
 * `setTimeout` and `requestAnimationFrame` (16 ms ticks ≈ 60 Hz).
 * Harness glue copied from `hooks/__tests__/useIdleFx.test.tsx`.
 * See change: add-fluid-chat-motion (D3).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PACE_DEADLINE_MS,
  PACE_SNAP_BACKLOG,
  type PacedTextOptions,
  usePacedText,
} from "../use-paced-text.js";

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const chars = (n: number, ch = "a") => ch.repeat(n);
const words = (n: number) => "word ".repeat(Math.ceil(n / 5)).slice(0, n);

type Props = { target: string } & PacedTextOptions;

function setup(initial: Props) {
  return renderHook((p: Props) => usePacedText(p.target, p), { initialProps: initial });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("usePacedText", () => {
  // E16 — the lag bound
  it("shows every char within 500 ms of its burst and paces between bursts (E16)", () => {
    const hook = setup({ target: "", active: true });
    const t0 = Date.now();
    const bursts: Array<{ end: number; at: number }> = [];
    const firstSeen = new Map<number, number>();
    const samples: number[] = [];
    let target = "";
    for (let elapsed = 0; elapsed < 3600; elapsed += 10) {
      if (elapsed < 3000 && elapsed % 50 === 0) {
        target += words(100);
        bursts.push({ end: target.length, at: elapsed });
        hook.rerender({ target, active: true });
      }
      advance(10);
      const shown = hook.result.current.length;
      samples.push(shown);
      bursts.forEach((b, i) => {
        if (!firstSeen.has(i) && shown >= b.end) firstSeen.set(i, elapsed + 10);
      });
    }
    for (const [i, b] of bursts.entries()) {
      const seenAt = firstSeen.get(i) ?? Number.POSITIVE_INFINITY;
      expect(seenAt - b.at, `burst ${i}`).toBeLessThanOrEqual(PACE_DEADLINE_MS + 100);
    }
    // Between bursts the length takes ≥ 2 distinct values (it is paced, not stepped).
    const window = samples.slice(0, 20);
    expect(new Set(window).size).toBeGreaterThanOrEqual(3);
    void t0;
  });

  // E17 — a stall dump
  it("a 400-char dump after an idle stall is fully shown within 500 ms (E17)", () => {
    const hook = setup({ target: "", active: true });
    advance(600);
    hook.rerender({ target: words(400), active: true });
    expect(hook.result.current.length).toBeLessThan(400);
    advance(500);
    expect(hook.result.current.length).toBe(400);
  });

  // E18 — snap threshold BVA
  it("snaps at backlog 4001 but paces at 4000 (E18)", () => {
    const paced = setup({ target: "", active: true });
    paced.rerender({ target: chars(PACE_SNAP_BACKLOG), active: true });
    advance(16);
    expect(paced.result.current.length).toBeLessThan(PACE_SNAP_BACKLOG);
    const snapped = setup({ target: "", active: true });
    snapped.rerender({ target: chars(PACE_SNAP_BACKLOG + 1), active: true });
    expect(snapped.result.current.length).toBe(PACE_SNAP_BACKLOG + 1);
  });

  // E19 — non-prefix target
  it("snaps when the shown text is no longer a prefix of the target (E19)", () => {
    const hook = setup({ target: "Hello wor", active: true });
    expect(hook.result.current).toBe("Hello wor");
    hook.rerender({ target: "Goodbye, my friend", active: true });
    expect(hook.result.current).toBe("Goodbye, my friend");
  });

  // E20 — reactivation sync
  it("re-activation never re-hides text the user already saw (E20)", () => {
    const hook = setup({ target: chars(100), active: true });
    hook.rerender({ target: chars(500), active: true });
    advance(16);
    hook.rerender({ target: chars(500), active: false });
    expect(hook.result.current.length).toBe(500);
    hook.rerender({ target: chars(900), active: false });
    expect(hook.result.current.length).toBe(900);
    hook.rerender({ target: chars(900), active: true });
    expect(hook.result.current.length).toBe(900);
    advance(100);
    expect(hook.result.current.length).toBe(900);
  });

  // E21 — frozen precedence
  it("frozen beats snap, sync and a hidden document; unfreeze shows everything older than the deadline (E21)", () => {
    const clock = { frozen: true };
    const opts = (target: string, active: boolean): Props => ({ target, active, frozen: clock.frozen, isFrozen: () => clock.frozen });
    const hook = setup(opts(chars(200), true));
    // 5000 chars arrive (beyond the snap threshold) and the document goes hidden.
    hook.rerender(opts(chars(5200), false));
    expect(hook.result.current.length).toBe(200);
    advance(2000);
    hook.rerender(opts(chars(5200), false));
    expect(hook.result.current.length).toBe(200);
    // Unfreeze 2 s later: all of it is older than the deadline → shown in the same render.
    clock.frozen = false;
    hook.rerender(opts(chars(5200), true));
    expect(hook.result.current.length).toBe(5200);
  });

  it("unfreeze with a sub-snap backlog reveals everything older than 400 ms at once, the rest flows (E21)", () => {
    const clock = { frozen: true };
    const opts = (target: string): Props => ({ target, active: true, frozen: clock.frozen, isFrozen: () => clock.frozen });
    const hook = setup(opts(chars(200)));
    hook.rerender(opts(chars(1200)));
    advance(2000);
    expect(hook.result.current.length).toBe(200); // nothing advanced while frozen
    clock.frozen = false;
    hook.rerender(opts(chars(1250))); // 50 fresh chars arrive on the unfreeze commit
    expect(hook.result.current.length).toBeGreaterThanOrEqual(1200);
    expect(hook.result.current.length).toBeLessThan(1250 + 1);
    advance(600);
    expect(hook.result.current.length).toBe(1250);
  });

  it("the synchronous clock stops a reveal step mid-flight (no step after a drag starts)", () => {
    const clock = { frozen: false };
    const opts = (target: string): Props => ({ target, active: true, isFrozen: () => clock.frozen });
    const hook = setup(opts(""));
    hook.rerender(opts(words(600)));
    advance(48);
    const before = hook.result.current.length;
    clock.frozen = true; // flips WITHOUT a React render
    advance(500);
    hook.rerender(opts(words(600)));
    expect(hook.result.current.length).toBe(before);
  });

  // E22 — rAF throttled
  it("a throttled rAF is covered by the setTimeout deadline backstop (E22)", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1);
    const hook = setup({ target: "", active: true });
    hook.rerender({ target: words(300), active: true });
    advance(PACE_DEADLINE_MS + 50);
    expect(hook.result.current.length).toBe(300);
    raf.mockRestore();
  });

  // E23 — target reset
  it("a target reset clears the queue and shown never exceeds the target (E23)", () => {
    const hook = setup({ target: "", active: true });
    hook.rerender({ target: words(800), active: true });
    advance(32);
    hook.rerender({ target: "", active: true });
    expect(hook.result.current).toBe("");
    hook.rerender({ target: "Hi", active: true });
    expect(hook.result.current.length).toBeLessThanOrEqual(2);
    advance(1000);
    expect(hook.result.current).toBe("Hi");
    expect(vi.getTimerCount()).toBe(0);
  });

  // rAF only while backlog > 0
  it("schedules no frame at rest (backlog 0)", () => {
    const hook = setup({ target: "", active: true });
    hook.rerender({ target: words(50), active: true });
    advance(1000);
    expect(hook.result.current.length).toBe(50);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is a pass-through while inactive", () => {
    const hook = setup({ target: "abc", active: false });
    hook.rerender({ target: "abcdef", active: false });
    expect(hook.result.current).toBe("abcdef");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("steps are frame-rate independent and never overshoot the target", () => {
    const hook = setup({ target: "", active: true });
    hook.rerender({ target: words(300), active: true });
    for (let i = 0; i < 100; i += 1) {
      advance(16);
      expect(hook.result.current.length).toBeLessThanOrEqual(300);
    }
    expect(hook.result.current.length).toBe(300);
  });
});

/**
 * P1 preview cost bound with fake timers: visible 10 s → 10 ± 1 requests;
 * hidden → 0; after 3 consecutive errors 0.2 fps; back to 1 fps after the first
 * success. See change: add-obs-studio-plugin (test-plan P1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewPoller } from "../usePreview.js";

function fakeDoc(initial: "visible" | "hidden" = "visible") {
  const listeners = new Set<() => void>();
  return {
    visibilityState: initial as DocumentVisibilityState,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    set(v: "visible" | "hidden") {
      this.visibilityState = v;
      for (const fn of listeners) fn();
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("P1 preview poller", () => {
  it("visible 10 s → 10 ± 1 requests", async () => {
    const doc = fakeDoc();
    let n = 0;
    const p = createPreviewPoller(async () => (n++, "data:x"), () => {}, doc as never);
    await vi.advanceTimersByTimeAsync(10_000);
    p.stop();
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(11);
  });

  it("hidden 10 s → 0 requests; visible again → polling resumes", async () => {
    const doc = fakeDoc("hidden");
    let n = 0;
    const p = createPreviewPoller(async () => (n++, "data:x"), () => {}, doc as never);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(n).toBe(0);
    doc.set("visible");
    await vi.advanceTimersByTimeAsync(2_500);
    expect(n).toBeGreaterThanOrEqual(2);
    doc.set("hidden");
    const at = n;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(n).toBe(at);
    p.stop();
  });

  it("3 errors → 0.2 fps; first success → back to 1 fps", async () => {
    const doc = fakeDoc();
    const times: number[] = [];
    let fail = true;
    const p = createPreviewPoller(
      async () => {
        times.push(Date.now());
        if (fail) throw new Error("x");
        return "data:x";
      },
      () => {},
      doc as never,
    );
    await vi.advanceTimersByTimeAsync(2_100); // calls at 0, 1000, 2000 → 3 errors
    expect(times).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(times).toHaveLength(3); // backoff: next at +5000
    await vi.advanceTimersByTimeAsync(1_000);
    expect(times).toHaveLength(4);
    expect(times[3] - times[2]).toBe(5000);
    fail = false;
    await vi.advanceTimersByTimeAsync(5_000); // the 5th call succeeds
    expect(times).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(times.length).toBeGreaterThanOrEqual(7);
    expect(times[6] - times[5]).toBe(1000);
    p.stop();
  });
});

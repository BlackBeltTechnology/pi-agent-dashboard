/**
 * Unit coverage for test-plan rows E17–E19 (capability `ui-animation-energy`,
 * change: fix-long-session-ux-degradation §7, design D8).
 *
 * `useIdleFx` marks the document root `fx-idle` after a settle window with no
 * deliberate input, so an unattended-but-visible dashboard stops driving the
 * compositor. The activity set is deliberately narrow: `pointermove` and
 * `scroll` are excluded (a resting hand + streaming auto-scroll would hold the
 * FX alive for an entire stream), and the five that count are listened at
 * CAPTURE on `document` so activity inside a stopped-propagation subtree still
 * counts.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_FX_DELAY_MS, useIdleFx } from "../useIdleFx.js";

const IDLE_CLASS = "fx-idle";
const hasIdleClass = () => document.documentElement.classList.contains(IDLE_CLASS);

/** The exact deliberate-input set from design D8 — order and membership both
 *  matter, so a drift here is a product change, not a test detail. */
const ACTIVITY_EVENTS = ["pointerdown", "wheel", "keydown", "touchstart", "focusin"] as const;

describe("useIdleFx", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.classList.remove(IDLE_CLASS);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.classList.remove(IDLE_CLASS);
    document.body.innerHTML = "";
  });

  // ── E17: the delay boundary is exactly IDLE_FX_DELAY_MS ────────────────────
  it("marks the root idle at the delay boundary, not one tick before", () => {
    expect(IDLE_FX_DELAY_MS).toBe(5000);
    renderHook(() => useIdleFx());

    vi.advanceTimersByTime(IDLE_FX_DELAY_MS - 1);
    expect(hasIdleClass()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(hasIdleClass()).toBe(true);
  });

  // ── E18: pointermove and scroll are NOT activity ───────────────────────────
  it("still goes idle after repeated pointermove and scroll events", () => {
    renderHook(() => useIdleFx());
    vi.advanceTimersByTime(IDLE_FX_DELAY_MS - 1000);

    // A resting hand + streaming auto-scroll: neither may reset the timer.
    for (let i = 0; i < 5; i += 1) {
      document.dispatchEvent(new Event("pointermove", { bubbles: true }));
      document.dispatchEvent(new Event("scroll", { bubbles: true }));
    }

    vi.advanceTimersByTime(1000);
    expect(hasIdleClass()).toBe(true);
  });

  // ── E19: each of the five activity events clears + restarts the delay ──────
  describe("activity clears the mark and restarts the delay", () => {
    for (const type of ACTIVITY_EVENTS) {
      it(`${type} — captured even from a stopped-propagation subtree`, () => {
        // A subtree whose own (bubble-phase) listener stops propagation. Only a
        // CAPTURE-phase document listener still sees the event.
        const subtree = document.createElement("div");
        subtree.addEventListener(type, (event) => event.stopPropagation());
        document.body.appendChild(subtree);

        renderHook(() => useIdleFx());
        vi.advanceTimersByTime(IDLE_FX_DELAY_MS);
        expect(hasIdleClass()).toBe(true);

        subtree.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
        expect(hasIdleClass()).toBe(false);

        // The delay restarted from the input: still not idle one tick early…
        vi.advanceTimersByTime(IDLE_FX_DELAY_MS - 1);
        expect(hasIdleClass()).toBe(false);
        // …and idle exactly one tick later.
        vi.advanceTimersByTime(1);
        expect(hasIdleClass()).toBe(true);
      });
    }
  });

  it("removes the class, the timer, and the listeners on unmount", () => {
    const { unmount } = renderHook(() => useIdleFx());
    vi.advanceTimersByTime(IDLE_FX_DELAY_MS);
    expect(hasIdleClass()).toBe(true);

    unmount();

    expect(hasIdleClass()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    // A post-unmount activity event must not re-arm the timer or touch the class.
    document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    vi.advanceTimersByTime(IDLE_FX_DELAY_MS * 2);
    expect(hasIdleClass()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

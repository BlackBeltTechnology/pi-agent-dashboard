/**
 * E14 + E15 (test-plan) for change: fix-pending-prompt-lost-on-replay.
 *
 * The pending-prompt desync detector (design D10) is gated five ways:
 * `currentTool === "ask_user"`, no pending interactive request, session not
 * ended, no replay in flight, condition held ≥ 5 s. The boolean decision is a
 * pure function; only the held-duration timer lives in a hook.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPromptDesync,
  PROMPT_DESYNC_GRACE_MS,
  type PromptDesyncGates,
  promptDesyncCondition,
  usePromptDesync,
} from "../prompt-desync.js";

function gates(over: Partial<PromptDesyncGates> = {}): PromptDesyncGates {
  return {
    currentTool: "ask_user",
    hasPendingInteractiveRequest: false,
    status: "streaming",
    replayInFlight: false,
    ...over,
  };
}

/** Cartesian product of the per-flag value lists (decision-table input space). */
function cartesian<T extends ReadonlyArray<ReadonlyArray<string>>>(
  lists: T,
): Array<{ [K in keyof T]: T[K][number] }> {
  return lists.reduce<Array<string[]>>(
    (acc, list) => acc.flatMap((prefix) => list.map((v) => [...prefix, v])),
    [[]],
  ) as Array<{ [K in keyof T]: T[K][number] }>;
}

describe("isPromptDesync decision table (test-plan #E14)", () => {
  it("is true in EXACTLY one cell of the 5-flag table", () => {
    const cells = cartesian([
      ["ask_user", "Read"],
      ["present", "absent"], // interactive request
      ["in-flight", "idle"], // replay
      ["ended", "active"], // session
      ["elapsed", "not"], // grace
    ] as const);

    const trueCells = cells
      .map(([currentTool, request, replay, session, grace]) => {
        const input = {
          ...gates({
            currentTool,
            hasPendingInteractiveRequest: request === "present",
            replayInFlight: replay === "in-flight",
            status: session === "ended" ? "ended" : "streaming",
          }),
          heldMs: grace === "elapsed" ? PROMPT_DESYNC_GRACE_MS : PROMPT_DESYNC_GRACE_MS - 1,
        };
        return isPromptDesync(input) ? `${currentTool} · request ${request} · replay ${replay} · session ${session} · grace ${grace}` : null;
      })
      .filter((c): c is string => c !== null);

    expect(trueCells).toEqual([
      "ask_user · request absent · replay idle · session active · grace elapsed",
    ]);
  });

  it("BVA: the grace boundary sits exactly at 5000 ms", () => {
    const base = gates();
    expect(isPromptDesync({ ...base, heldMs: 4999 })).toBe(false);
    expect(isPromptDesync({ ...base, heldMs: 5000 })).toBe(true);
  });

  it("promptDesyncCondition isolates the four instantaneous gates", () => {
    expect(promptDesyncCondition(gates())).toBe(true);
    expect(promptDesyncCondition(gates({ currentTool: "Read" }))).toBe(false);
    expect(promptDesyncCondition(gates({ hasPendingInteractiveRequest: true }))).toBe(false);
    expect(promptDesyncCondition(gates({ replayInFlight: true }))).toBe(false);
    expect(promptDesyncCondition(gates({ status: "ended" }))).toBe(false);
  });
});

describe("usePromptDesync grace timer (test-plan #E15)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("no affordance at 4.9 s, affordance at 5.1 s", () => {
    const { result } = renderHook(() => usePromptDesync(gates()));

    // Condition established. Inside the grace window: nothing.
    act(() => {
      vi.advanceTimersByTime(4900);
    });
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(true);
  });

  it("a failing gate RESETS the held-duration timer, not pauses it", () => {
    let current: PromptDesyncGates = gates();
    const { result, rerender } = renderHook(() => usePromptDesync(current));

    act(() => {
      vi.advanceTimersByTime(5100);
    });
    expect(result.current).toBe(true);

    // A replay starts: gate fails → affordance gone immediately.
    current = gates({ replayInFlight: true });
    rerender();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe(false);

    // Replay ends at t=5.1 s: the timer restarts from zero, so 4.9 s later
    // there is still no affordance; only after a fresh 5 s.
    current = gates();
    rerender();
    act(() => {
      vi.advanceTimersByTime(4900);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(true);
  });

  it("a rendered dialog (pending request present) suppresses the affordance", () => {
    let current: PromptDesyncGates = gates();
    const { result, rerender } = renderHook(() => usePromptDesync(current));

    act(() => {
      vi.advanceTimersByTime(5100);
    });
    expect(result.current).toBe(true);

    current = gates({ hasPendingInteractiveRequest: true });
    rerender();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe(false);
  });

  it("a scope (session) switch resets the grace clock — no cross-session bleed", () => {
    // `<ChatView>` is reused across session switches (no `key`), so the hook
    // must not carry session A's elapsed grace into session B even when both
    // hold the condition. Mirrors the replay-pill `pillForSession` guard.
    let scope: string | undefined = "session-a";
    const { result, rerender } = renderHook(() => usePromptDesync(gates(), scope));

    act(() => {
      vi.advanceTimersByTime(5100);
    });
    expect(result.current).toBe(true);

    scope = "session-b";
    rerender();
    act(() => {
      vi.advanceTimersByTime(4900);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(true);
  });
});

/**
 * Pure history-load phase derivation. See change: show-session-history-load-state
 * (test-plan #E1, #E2).
 */
import { describe, expect, it } from "vitest";
import { createInitialState } from "../../chat/event-reducer.js";
import { buildHistoryPhaseMap, deriveHistoryLoadPhase, type HistoryLoadPhase, hasChatContent } from "../history-load-phase.js";

function expected(i: { selected: boolean; connected: boolean; hasContent: boolean; loading: boolean; failed: boolean }): HistoryLoadPhase {
  if (i.selected && !i.connected && !i.hasContent) return "waiting";
  if (i.loading && i.connected) return "loading";
  if (i.failed && i.connected && !i.hasContent) return "failed";
  return "idle";
}

describe("deriveHistoryLoadPhase (#E1)", () => {
  const bools = [false, true];
  const combos: Array<{ selected: boolean; connected: boolean; hasContent: boolean; loading: boolean; failed: boolean }> = [];
  for (const selected of bools)
    for (const connected of bools)
      for (const hasContent of bools)
        for (const loading of bools)
          for (const failed of bools) combos.push({ selected, connected, hasContent, loading, failed });

  it("covers all 32 combinations", () => {
    expect(combos).toHaveLength(32);
  });

  it.each(combos)("%o", (i) => {
    expect(deriveHistoryLoadPhase(i)).toBe(expected(i));
  });

  it("spot-checks precedence: waiting beats loading and failed", () => {
    expect(deriveHistoryLoadPhase({ selected: true, connected: false, hasContent: false, loading: true, failed: true })).toBe("waiting");
    expect(deriveHistoryLoadPhase({ selected: false, connected: true, hasContent: false, loading: true, failed: true })).toBe("loading");
    expect(deriveHistoryLoadPhase({ selected: false, connected: true, hasContent: true, loading: true, failed: false })).toBe("loading");
    expect(deriveHistoryLoadPhase({ selected: false, connected: true, hasContent: true, loading: false, failed: true })).toBe("idle");
  });
});

describe("hasChatContent (#E2)", () => {
  it("(a) undefined state, no steering → false", () => {
    expect(hasChatContent(undefined)).toBe(false);
  });
  it("(b) undefined state, steering present → true", () => {
    expect(hasChatContent(undefined, ["x"])).toBe(true);
  });
  it("(c) only streamingText → true", () => {
    expect(hasChatContent({ ...createInitialState(), streamingText: "hi" })).toBe(true);
  });
  it("(d) only pendingPrompt → true", () => {
    const st = { ...createInitialState(), pendingPrompt: { text: "p" } } as unknown as ReturnType<typeof createInitialState>;
    expect(hasChatContent(st)).toBe(true);
  });
  it("(e) empty messages + empty steering → false", () => {
    expect(hasChatContent(createInitialState(), [])).toBe(false);
  });
});

describe("buildHistoryPhaseMap", () => {
  it("stores only non-idle entries over true-valued ids + selected", () => {
    const map = buildHistoryPhaseMap({
      loadingHistory: new Map([["a", true], ["old", false]]),
      replayInFlight: new Map([["b", true]]),
      historyLoadFailed: new Map([["c", true]]),
      historyLoadStartedAt: new Map([["a", 1000], ["b", 2000]]),
      selectedId: "d",
      connected: true,
      hasContent: (id) => id === "b",
    });
    expect([...map.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(map.get("a")).toEqual({ phase: "loading", startedAt: 1000 });
    expect(map.get("b")).toEqual({ phase: "loading", startedAt: 2000 });
    expect(map.get("c")).toEqual({ phase: "failed" });
  });

  it("selected empty session while disconnected → waiting, other loaders idle", () => {
    const map = buildHistoryPhaseMap({
      loadingHistory: new Map([["a", true], ["s", true]]),
      replayInFlight: new Map(),
      historyLoadFailed: new Map(),
      historyLoadStartedAt: new Map(),
      selectedId: "s",
      connected: false,
      hasContent: () => false,
    });
    expect([...map.entries()]).toEqual([["s", { phase: "waiting" }]]);
  });
});

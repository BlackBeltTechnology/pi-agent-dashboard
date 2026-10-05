/**
 * Turn bookkeeping (`TurnStat`, `turnIndex`, `turnCount`) runs only for
 * turn-kind `stats_update`; totals (cache included) run for every kind.
 * Harness: event-reducer.test.ts.
 *
 * test-plan #E19. See change: count-non-message-usage.
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent, type SessionState } from "../chat/event-reducer.js";

const ev = (eventType: string, data: Record<string, unknown>): DashboardEvent =>
  ({ eventType, timestamp: 1, data }) as DashboardEvent;

function withUserMessage(): SessionState {
  return reduceEvent(createInitialState(), ev("message_start", { message: { role: "user", content: "hello" } }));
}

describe("#E19 reducer: turn bookkeeping only for turn kind", () => {
  it("non-turn usage adds cache/totals, leaves turn state untouched; a later turn-kind event does the bookkeeping", () => {
    const s0 = withUserMessage();
    const lastUser = (s: SessionState) => s.messages.findLast((m) => m.role === "user");
    expect(lastUser(s0)?.turnIndex).toBeUndefined();

    const s1 = reduceEvent(
      s0,
      ev("stats_update", {
        usageKind: "usage:cache_warm",
        tokensIn: 0,
        tokensOut: 0,
        cost: 0.015,
        turnUsage: { input: 0, output: 0, cacheRead: 50000, cacheWrite: 0 },
      }),
    );
    expect(s1.cacheRead).toBe(s0.cacheRead + 50000);
    expect(s1.cost).toBeCloseTo(s0.cost + 0.015, 10);
    expect(s1.turnStats).toEqual(s0.turnStats);
    expect(s1.turnCount).toBe(s0.turnCount);
    expect(lastUser(s1)?.turnIndex).toBeUndefined();

    const s2 = reduceEvent(
      s1,
      ev("stats_update", {
        tokensIn: 100,
        tokensOut: 10,
        cost: 0.001,
        turnUsage: { input: 100, output: 10, cacheRead: 1, cacheWrite: 2 },
      }),
    );
    expect(s2.turnStats).toHaveLength(s1.turnStats.length + 1);
    expect(s2.turnCount).toBe(s1.turnCount + 1);
    expect(lastUser(s2)?.turnIndex).toBe(s1.turnCount);
    expect(s2.turnStats[s2.turnStats.length - 1].turnIndex).toBe(s1.turnCount);
    expect(s2.cacheRead).toBe(s1.cacheRead + 1);
  });

  it("explicit usageKind \"turn\" is turn kind", () => {
    const s0 = withUserMessage();
    const s1 = reduceEvent(
      s0,
      ev("stats_update", { usageKind: "turn", tokensIn: 1, turnUsage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } }),
    );
    expect(s1.turnStats).toHaveLength(s0.turnStats.length + 1);
    expect(s1.turnCount).toBe(s0.turnCount + 1);
  });

  it.each(["tool", "compaction", "branch_summary", "usage:future_kind"])("%s never appends a TurnStat", (usageKind) => {
    const s0 = withUserMessage();
    const s1 = reduceEvent(
      s0,
      ev("stats_update", { usageKind, tokensIn: 5, turnUsage: { input: 5, output: 0, cacheRead: 0, cacheWrite: 3 } }),
    );
    expect(s1.turnStats).toEqual(s0.turnStats);
    expect(s1.turnCount).toBe(s0.turnCount);
    expect(s1.tokensIn).toBe(s0.tokensIn + 5);
    expect(s1.cacheWrite).toBe(s0.cacheWrite + 3);
  });
});

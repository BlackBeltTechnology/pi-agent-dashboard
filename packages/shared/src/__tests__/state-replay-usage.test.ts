/**
 * Replay synthesizes kind-marked stats for non-message usage, so hydration's
 * replace-with-replay totals equal the JSONL-derived totals while the context
 * gauge stays assistant-driven. Harness: state-replay.test.ts.
 *
 * test-plan #E20. See change: count-non-message-usage.
 */
import { describe, expect, it } from "vitest";
import { replayEntriesAsEvents } from "../state-replay.js";
import { sumEntryUsage } from "../usage-totals.js";

const usage = (u: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; cost?: number }) => ({
  input: u.input ?? 0,
  output: u.output ?? 0,
  cacheRead: u.cacheRead ?? 0,
  cacheWrite: u.cacheWrite ?? 0,
  totalTokens: u.totalTokens ?? 0,
  cost: { total: u.cost ?? 0 },
});

const entries = [
  { type: "model_change", id: "m0", provider: "anthropic", modelId: "claude-sonnet-4-20250514", timestamp: "2026-01-01T00:00:00Z" },
  { type: "message", id: "u1", message: { role: "user", content: "go" } },
  { type: "message", id: "a1", message: { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "classify", arguments: {} }], usage: usage({ input: 1000, output: 100, cacheRead: 10, totalTokens: 12000, cost: 0.01 }) } },
  { type: "message", id: "r1", message: { role: "toolResult", toolCallId: "t1", toolName: "classify", content: [], usage: usage({ input: 300, cost: 0.001 }) } },
  { type: "usage", id: "w1", kind: "cache_warm", provider: "anthropic", model: "claude-sonnet-4", usage: usage({ cacheRead: 50000, cost: 0.015 }) },
  { type: "compaction", id: "c1", summary: "s", firstKeptEntryId: "a1", tokensBefore: 1, usage: usage({ input: 40000, output: 900, totalTokens: 40000, cost: 0.12 }) },
  { type: "branch_summary", id: "b1", fromId: "a1", summary: "b", usage: usage({ input: 700, cacheWrite: 7, cost: 0.007 }) },
];

/** Same summation `extractStatsFromEvents` performs (server hydration). */
function totalsFromEvents(events: ReturnType<typeof replayEntriesAsEvents>) {
  const t = { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const m of events) {
    if (m.event.eventType !== "stats_update") continue;
    const d = m.event.data as any;
    t.tokensIn += d.tokensIn ?? 0;
    t.tokensOut += d.tokensOut ?? 0;
    t.cost += d.cost ?? 0;
    t.cacheRead += d.turnUsage?.cacheRead ?? 0;
    t.cacheWrite += d.turnUsage?.cacheWrite ?? 0;
  }
  return t;
}

describe("#E20 replay synthesizes non-message stats", () => {
  const events = replayEntriesAsEvents("s1", entries, 1_000_000);
  const stats = events.filter((m) => m.event.eventType === "stats_update").map((m) => m.event.data as any);

  it("emits 4 kind-marked stats_update without contextUsage", () => {
    const kinded = stats.filter((d) => d.usageKind !== undefined);
    expect(kinded.map((d) => d.usageKind)).toEqual(["tool", "usage:cache_warm", "compaction", "branch_summary"]);
    for (const d of kinded) expect(d).not.toHaveProperty("contextUsage");
  });

  it("replayed totals equal the shared JSONL-derived totals", () => {
    const fromReplay = totalsFromEvents(events);
    const derived = sumEntryUsage(entries);
    expect(fromReplay.tokensIn).toBe(derived.tokensIn);
    expect(fromReplay.tokensOut).toBe(derived.tokensOut);
    expect(fromReplay.cacheRead).toBe(derived.cacheRead);
    expect(fromReplay.cacheWrite).toBe(derived.cacheWrite);
    expect(fromReplay.cost).toBeCloseTo(derived.cost, 12);
  });

  it("the last contextUsage is the assistant's, with the caller's contextWindow", () => {
    const withCtx = stats.filter((d) => d.contextUsage);
    expect(withCtx).toHaveLength(1);
    expect(withCtx[withCtx.length - 1].contextUsage).toEqual({ tokens: 12000, contextWindow: 1_000_000 });
  });

  it("tool results replay as tool_execution_end, never message_end", () => {
    expect(events.some((m) => m.event.eventType === "tool_execution_end")).toBe(true);
    expect(
      events.some((m) => m.event.eventType === "message_end" && (m.event.data as any).message?.role === "toolResult"),
    ).toBe(false);
  });
});

describe("assistant replay arm normalizes like the JSONL reader", () => {
  it("negative / non-finite assistant usage replays as the same clamped totals sumEntryUsage derives", () => {
    const bad = [
      { type: "message", id: "a1", message: { role: "assistant", content: [], usage: { input: -50, output: 10, cacheRead: Number.NaN, cacheWrite: -1, totalTokens: 900, cost: { total: -0.2 } } } },
    ];
    const replay = replayEntriesAsEvents("s1", bad, 1_000_000);
    const t = totalsFromEvents(replay);
    expect(t).toEqual(sumEntryUsage(bad));
    expect(t).toEqual({ tokensIn: 0, tokensOut: 10, cacheRead: 0, cacheWrite: 0, cost: 0 });
    const ctx = replay.map((m) => (m.event.data as any).contextUsage).filter(Boolean);
    expect(ctx).toEqual([{ tokens: 900, contextWindow: 1_000_000 }]);
  });
});

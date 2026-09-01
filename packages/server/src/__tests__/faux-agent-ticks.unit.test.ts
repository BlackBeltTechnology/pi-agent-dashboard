/**
 * L1 for the synthetic Agent-tick producer's cadence parser (change:
 * reduce-bridge-tick-bandwidth). The producer streams `tool_execution_update`
 * frames whose count + spacing are set by a `[[ticks:<count>@<intervalMs>]]`
 * sentinel in the tool-call prompt; a mis-parse silently changes the cadence a
 * throttle L3 row asserts against, so the mapping is pinned here.
 *
 * Imports the fixture through the same cross-package path the faux-router unit
 * test uses (`../../../../qa/fixtures/...`).
 */

import { describe, expect, it } from "vitest";
import fauxAgentTicks, {
  buildEntries,
  entryCountAt,
  parseBusIntervalMs,
  parseEntriesPlan,
  parseTickPlan,
} from "../../../../qa/fixtures/faux-agent-ticks.ext.js";

/** Drive the fixture's `Agent` tool with a captured EventBus + update stream. */
async function runFixture(prompt: string): Promise<{
  bus: Array<{ channel: string; data: any }>;
  updates: any[];
  result: any;
}> {
  const bus: Array<{ channel: string; data: any }> = [];
  const updates: any[] = [];
  let tool: any;
  const pi = {
    registerTool: (t: unknown) => {
      tool = t;
    },
    events: { emit: (channel: string, data: unknown) => bus.push({ channel, data }) },
  };
  fauxAgentTicks(pi as never);
  const result = await tool.execute(
    "call-1",
    { subagent_type: "Explore", description: "d", prompt },
    undefined,
    (p: unknown) => updates.push(p),
    undefined,
  );
  return { bus, updates, result };
}

describe("parseTickPlan", () => {
  it("parses count + intervalMs from the sentinel", () => {
    expect(parseTickPlan("[[ticks:240@50]] go")).toEqual({
      count: 240,
      intervalMs: 50,
      gapMs: 0,
      gapAt: -1,
    });
  });

  it("parses the optional quiet-gap suffix", () => {
    expect(parseTickPlan("[[ticks:120@50+gap2500@30]] go")).toEqual({
      count: 120,
      intervalMs: 50,
      gapMs: 2500,
      gapAt: 30,
    });
  });

  it("falls back to the 240 @ 50 ms default with no sentinel", () => {
    expect(parseTickPlan("plain prompt")).toEqual({
      count: 240,
      intervalMs: 50,
      gapMs: 0,
      gapAt: -1,
    });
    expect(parseTickPlan(undefined)).toEqual({
      count: 240,
      intervalMs: 50,
      gapMs: 0,
      gapAt: -1,
    });
  });

  it("defaults the gap when only count@interval is given (no partial gap state)", () => {
    const plan = parseTickPlan("[[ticks:10@100]] x");
    expect(plan.gapMs).toBe(0);
    expect(plan.gapAt).toBe(-1);
  });

  it("clamps hostile/typo'd values so the producer loop cannot wedge", () => {
    // A digit string long enough to overflow to Infinity must not become an
    // unbounded `count`: a non-finite parse falls back to the sane default
    // (bounded), and a 0 interval is floored to 1 so it cannot spin the loop.
    const huge = "9".repeat(400); // Number(huge) === Infinity
    const plan = parseTickPlan(`[[ticks:${huge}@0]] x`);
    expect(Number.isFinite(plan.count)).toBe(true);
    expect(plan.count).toBe(240); // Infinity -> bounded fallback
    expect(plan.intervalMs).toBe(1); // floored off 0

    // A large-but-finite count is capped at MAX_TICKS.
    expect(parseTickPlan("[[ticks:5000000@50]] x").count).toBe(100_000);

    // An in-range value is untouched; an over-cap gap is clamped.
    expect(parseTickPlan("[[ticks:240@50+gap9999999@30]] x")).toEqual({
      count: 240,
      intervalMs: 50,
      gapMs: 600_000, // MAX_GAP_MS
      gapAt: 30,
    });
  });
});

/**
 * Pull-path substrate contract (change: verify-subagent-pull-under-load).
 *
 * These are not parser trivia. Each row below is a way the L3 pull-path spec
 * could go GREEN WITHOUT EXERCISING THE PULL PATH, which is the specific
 * failure this change exists to prevent:
 *   - growth silently off  -> nothing to converge on
 *   - `data.id` missing    -> every resync is a silent no-op
 *   - fat `created` frame  -> forwarded unstripped, thin-push guard defeated
 *   - a delta encoding     -> breaks the latest-supersedes pipeline invariant
 */
describe("parseEntriesPlan (E1/E2)", () => {
  it("E1: no sentinel => no growth plan at all (fixture stays byte-identical)", () => {
    expect(parseEntriesPlan("[[ticks:240@50]] go", 240)).toBeUndefined();
    expect(parseEntriesPlan(undefined, 240)).toBeUndefined();
    // ...and with no plan every tick carries an EMPTY timeline.
    expect(entryCountAt(undefined, 0)).toBe(0);
    expect(entryCountAt(undefined, 999)).toBe(0);
  });

  it("E2: parses start..end and defaults the growth span to half the plan", () => {
    expect(parseEntriesPlan("[[entries:5..30]] go", 240)).toEqual({
      start: 5,
      end: 30,
      growTicks: 120,
    });
  });

  it("E2: honours an explicit growth span, bounded by the tick plan", () => {
    expect(parseEntriesPlan("[[entries:5..30@60]] go", 240)).toEqual({
      start: 5,
      end: 30,
      growTicks: 60,
    });
    // A span longer than the run cannot outlive the run.
    expect(parseEntriesPlan("[[entries:5..30@900]] go", 240)?.growTicks).toBe(240);
  });

  it("E2: 0..0 yields an always-empty timeline (a valid degenerate arm)", () => {
    const plan = parseEntriesPlan("[[entries:0..0]] go", 10);
    expect(plan).toEqual({ start: 0, end: 0, growTicks: 5 });
    expect(entryCountAt(plan, 0)).toBe(0);
    expect(entryCountAt(plan, 10)).toBe(0);
  });

  it("E2: inverted and malformed sentinels fall back to NO growth, never a guess", () => {
    expect(parseEntriesPlan("[[entries:30..5]] go", 240)).toBeUndefined();
    expect(parseEntriesPlan("[[entries:x..y]] go", 240)).toBeUndefined();
    expect(parseEntriesPlan("[[entries:5..]] go", 240)).toBeUndefined();
    expect(parseEntriesPlan("[[entries:5-30]] go", 240)).toBeUndefined();
  });

  it("E2: an absurd end count is capped, so a snapshot cannot blow the byte budget", () => {
    expect(parseEntriesPlan("[[entries:0..99999999]] go", 240)?.end).toBe(5_000);
    const huge = "9".repeat(400); // Number(huge) === Infinity
    expect(parseEntriesPlan(`[[entries:0..${huge}]] go`, 240)?.end).toBe(0);
  });
});

describe("parseBusIntervalMs (E6)", () => {
  it("E6: absent => undefined, i.e. NO subagents:* traffic at all", () => {
    expect(parseBusIntervalMs("[[ticks:240@50]] go")).toBeUndefined();
    expect(parseBusIntervalMs(undefined)).toBeUndefined();
  });

  it("E6: 250 ms is the value that matches the real producer's throttle", () => {
    expect(parseBusIntervalMs("[[bus:250]] go")).toBe(250);
  });

  it("E6: clamps out-of-range values instead of spinning or stalling", () => {
    expect(parseBusIntervalMs("[[bus:0]] go")).toBe(10); // MIN_BUS_MS
    expect(parseBusIntervalMs("[[bus:999999]] go")).toBe(60_000); // MAX_BUS_MS
    const huge = "9".repeat(400);
    expect(parseBusIntervalMs(`[[bus:${huge}]] go`)).toBe(250); // non-finite -> default
  });

  it("E6: the bus interval is INDEPENDENT of the tick interval", () => {
    // A per-tick bus stream would fabricate a ~5x inflated push arm in the P4
    // A/B, so the two cadences must not be coupled.
    const prompt = "[[ticks:240@50]][[bus:250]] go";
    expect(parseTickPlan(prompt).intervalMs).toBe(50);
    expect(parseBusIntervalMs(prompt)).toBe(250);
  });
});

describe("entryCountAt + buildEntries (E5)", () => {
  const plan = parseEntriesPlan("[[entries:5..30@60]] go", 240)!;

  it("starts at `start`, reaches `end` at the growth span, then PLATEAUS", () => {
    expect(entryCountAt(plan, 0)).toBe(5);
    expect(entryCountAt(plan, 30)).toBe(18); // 5 + round(25 * 30/60)
    expect(entryCountAt(plan, 60)).toBe(30);
    // The plateau is load-bearing: it is what lets a cadence resync converge the
    // rendered count WHILE THE AGENT IS STILL RUNNING.
    expect(entryCountAt(plan, 120)).toBe(30);
    expect(entryCountAt(plan, 240)).toBe(30);
  });

  it("never decreases across the run", () => {
    let prev = -1;
    for (let i = 0; i <= 240; i++) {
      const n = entryCountAt(plan, i);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it("E5: every snapshot is FULL and a prefix-superset of its predecessor", () => {
    // The pipeline is latest-supersedes: the producer throttle, the bridge frame
    // buffer, the server collapse predicate and WS back-pressure ALL assume a
    // frame is an idempotent full snapshot. A delta breaks all four.
    const startedAt = 1_000;
    let prev = buildEntries(entryCountAt(plan, 0), startedAt);
    for (let i = 1; i <= 240; i++) {
      const cur = buildEntries(entryCountAt(plan, i), startedAt);
      expect(cur.length).toBeGreaterThanOrEqual(prev.length);
      // Entry k is byte-identical across frames => append-only, no rewrite.
      expect(cur.slice(0, prev.length)).toEqual(prev);
      prev = cur;
    }
    expect(prev).toHaveLength(30);
  });

  it("entries are small and fixed-shape, so the snapshot stays far under 256 KiB", () => {
    const bytes = JSON.stringify(buildEntries(30, 1_000)).length;
    expect(bytes).toBeLessThan(4_000); // vs the store's ~262144 B budget
  });
});

describe("emitted frame shape (E3/E4/E7)", () => {
  it("E7: without the bus sentinel the fixture emits NO subagents:* frames", async () => {
    const { bus, updates } = await runFixture("[[ticks:4@1]] go");
    expect(bus).toHaveLength(0);
    // ...and the tick carrier is unchanged: still an empty timeline.
    expect(updates).toHaveLength(4);
    expect(updates[0].details.entries).toEqual([]);
  });

  it("E3: every bus frame carries a TOP-LEVEL id equal to details.agentId", async () => {
    const { bus } = await runFixture("[[ticks:4@1]][[entries:1..3@2]][[bus:10]] go");
    expect(bus.length).toBeGreaterThan(0);
    const channels = bus.map((f) => f.channel);
    expect(channels[0]).toBe("subagents:created");
    expect(channels).toContain("subagents:started");
    expect(channels[channels.length - 1]).toBe("subagents:completed");
    for (const frame of bus) {
      // `SubagentFrameBuffer.agentIdOf` keys the retained snapshot on `data.id`
      // and `resync()` looks it up by that key. An id living only inside
      // `details` makes every resync a silent no-op.
      expect(typeof frame.data.id).toBe("string");
      expect(frame.data.id).not.toBe("");
      expect(frame.data.id).toBe(frame.data.details.agentId);
    }
    // One agent per run: every frame shares the id.
    expect(new Set(bus.map((f) => f.data.id)).size).toBe(1);
  });

  it("E4: the subagents:created frame carries NO entries", async () => {
    const { bus } = await runFixture("[[ticks:4@1]][[entries:5..8@2]][[bus:10]] go");
    const created = bus.find((f) => f.channel === "subagents:created")!;
    // `"created"` is not in the bridge's strip allowlist (queued/running), so a
    // fat created frame would forward UNSTRIPPED and defeat the thin-push guard.
    expect(created.data.details.status).toBe("created");
    expect(created.data.details.entries).toEqual([]);
  });

  it("the terminal frame is fat, and the tick carrier grows alongside the bus", async () => {
    const { bus, updates, result } = await runFixture(
      "[[ticks:6@1]][[entries:2..5@3]][[bus:10]] go",
    );
    const completed = bus.find((f) => f.channel === "subagents:completed")!;
    expect(completed.data.details.status).toBe("completed");
    expect(completed.data.details.entries).toHaveLength(5);
    expect(result.details.entries).toHaveLength(5);
    expect(updates[0].details.entries).toHaveLength(2);
    expect(updates[updates.length - 1].details.entries).toHaveLength(5);
  });
});

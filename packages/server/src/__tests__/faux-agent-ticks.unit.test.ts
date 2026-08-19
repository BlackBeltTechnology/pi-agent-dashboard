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
import { parseTickPlan } from "../../../../qa/fixtures/faux-agent-ticks.ext.js";

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

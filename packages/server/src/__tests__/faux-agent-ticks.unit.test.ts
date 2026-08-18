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
});

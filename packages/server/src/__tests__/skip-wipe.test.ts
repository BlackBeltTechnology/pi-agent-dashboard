/**
 * Tests for bridge reconnect / resume skip-wipe logic in event-wiring.
 *
 * The wipe-skip decision now tolerates pi's auto-appended setup-entry count
 * drift (change: bound-bridge-resume-replay, D3): a genuine resume of an
 * UNCHANGED transcript reports a slightly higher eventCount than the stored
 * lastEntryCount, and must reuse the loaded store rather than wipe + refill.
 */
import { describe, expect, it } from "vitest";
import { canSkipEventWipe, SETUP_ENTRY_DELTA_ALLOWANCE } from "../event-wiring.js";

describe("canSkipEventWipe", () => {
  it("skips wipe when eventCount matches exactly (store non-empty)", () => {
    expect(canSkipEventWipe(3, 3, true)).toBe(true);
  });

  it("skips wipe when eventCount is within the setup-entry allowance", () => {
    // pi appended 2 setup entries (model_change + thinking_level_change).
    expect(canSkipEventWipe(3 + 2, 3, true)).toBe(true);
    // Exactly at the allowance boundary.
    expect(canSkipEventWipe(10 + SETUP_ENTRY_DELTA_ALLOWANCE, 10, true)).toBe(true);
  });

  it("wipes when the delta exceeds the setup-entry allowance (new turns)", () => {
    expect(canSkipEventWipe(10 + SETUP_ENTRY_DELTA_ALLOWANCE + 1, 10, true)).toBe(false);
    expect(canSkipEventWipe(50, 10, true)).toBe(false);
  });

  it("wipes when the bridge reports FEWER entries than stored (negative delta)", () => {
    expect(canSkipEventWipe(8, 10, true)).toBe(false);
  });

  it("always wipes when the store is empty, regardless of count delta", () => {
    expect(canSkipEventWipe(3, 3, false)).toBe(false);
    expect(canSkipEventWipe(5, 3, false)).toBe(false);
  });

  it("wipes when eventCount is not provided (backward compat)", () => {
    expect(canSkipEventWipe(undefined, 3, true)).toBe(false);
  });

  it("wipes when lastEntryCount is unknown (first connect / no prior state)", () => {
    expect(canSkipEventWipe(5, undefined, true)).toBe(false);
  });
});

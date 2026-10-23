/**
 * Load-bearing inequality between the two recovery windows.
 *
 * `announceRestart` tells every bridge to suppress reconnection for
 * `RESTART_QUIESCE_MS`. If the reattach grace window closes BEFORE that, a
 * surviving bridge cannot possibly retract its candidate in time — which is
 * exactly why the 07-22 liveness gate never fired on the restart path
 * (2500 ms grace vs 5000 ms quiesce, with no test relating the two).
 *
 * See change: fix-recovery-exit-intent (task 1.3 / 5.1).
 */
import { describe, expect, it } from "vitest";
import {
  RECONNECT_HEADROOM_MS,
  RECOVERY_REATTACH_GRACE_MS,
  RESTART_QUIESCE_MS,
} from "../recovery-timing.js";

describe("recovery timing constants", () => {
  it("the reattach grace window outlasts the restart quiesce window", () => {
    expect(RECOVERY_REATTACH_GRACE_MS).toBeGreaterThan(RESTART_QUIESCE_MS);
  });

  it("the grace window is derived from the quiesce window plus headroom", () => {
    expect(RECOVERY_REATTACH_GRACE_MS).toBe(RESTART_QUIESCE_MS + RECONNECT_HEADROOM_MS);
    expect(RECONNECT_HEADROOM_MS).toBeGreaterThan(0);
  });
});

// See change: harden-bridge-inbound-and-discovery (test-plan BE8).
import { readFileSync } from "node:fs";
import { MAX_QUIESCE_MS, normalizeQuiesceMs, SHUTDOWN_QUIESCE_MS } from "../recovery-timing.js";

/**
 * @structural-pin the server route must import SHUTDOWN_QUIESCE_MS from shared, never redeclare it (BE8: one source for the window the bound is derived from)
 */
describe("quiesce bound constants (BE8)", () => {
  it("MAX_QUIESCE_MS is 120000 and at least 2x the largest announced window", () => {
    expect(MAX_QUIESCE_MS).toBe(120000);
    expect(MAX_QUIESCE_MS).toBeGreaterThanOrEqual(2 * Math.max(SHUTDOWN_QUIESCE_MS, RESTART_QUIESCE_MS));
    expect(SHUTDOWN_QUIESCE_MS).toBe(60000);
  });

  it("system-routes imports SHUTDOWN_QUIESCE_MS from shared, not redeclared", () => {
    const src = readFileSync(new URL("../../../server/src/routes/system-routes.ts", import.meta.url), "utf8");
    expect(src).toMatch(/SHUTDOWN_QUIESCE_MS[^;]*from "@blackbelt-technology\/pi-dashboard-shared\/recovery-timing\.js"/);
    expect(src).not.toMatch(/const SHUTDOWN_QUIESCE_MS/);
  });

  it("normalizeQuiesceMs: invalid ignored, fractions rounded up, clamped", () => {
    for (const v of [0, -1, -0.5, Number.NaN, "5000", null, undefined, {}, true]) expect(normalizeQuiesceMs(v)).toBeUndefined();
    expect(normalizeQuiesceMs(5000.1)).toBe(5001);
    expect(normalizeQuiesceMs(0.2)).toBe(1);
    expect(normalizeQuiesceMs(5000)).toBe(5000);
    expect(normalizeQuiesceMs(1e15)).toBe(120000);
    expect(normalizeQuiesceMs(Number.POSITIVE_INFINITY)).toBe(120000);
  });
});

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

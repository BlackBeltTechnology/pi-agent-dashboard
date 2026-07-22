/**
 * Lifecycle counters (test-plan #E20, #E21): each decision path increments the
 * matching counter, and the snapshot reports live active/idle + reaped-by-reason
 * for the diagnostics surface.
 * See change: add-embed-session-lifecycle.
 */
import { describe, expect, it } from "vitest";
import { createLifecycleMetrics } from "../lifecycle-metrics.js";

describe("lifecycle metrics", () => {
  // E20 — each path fires its counter.
  it("increments reuse hit/miss, reaped-by-reason, and capacity rejections", () => {
    const m = createLifecycleMetrics();
    m.recordReuse(true);
    m.recordReuse(false);
    m.recordReuse(false);
    m.recordReap("idle");
    m.recordReap("phantom");
    m.recordReap("phantom");
    m.recordCapacityReject();

    const s = m.snapshot();
    expect(s.reuseHits).toBe(1);
    expect(s.reuseMisses).toBe(2);
    expect(s.reaped).toEqual({ idle: 1, "stop-after-turn": 0, phantom: 2 });
    expect(s.capacityRejections).toBe(1);
  });

  // E21 — snapshot reports live active/idle from the injected accessors.
  it("reports live active/idle counts from injected accessors", () => {
    const m = createLifecycleMetrics({
      countActiveEphemeral: () => 4,
      countIdleEphemeral: () => 1,
    });
    const s = m.snapshot();
    expect(s.activeEphemeral).toBe(4);
    expect(s.idleEphemeral).toBe(1);
  });
});

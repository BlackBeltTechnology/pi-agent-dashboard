/**
 * Unit tests for the `decideDashboardSource` pure decision function.
 *
 * Pins the matrix:
 *   - dashboardSpawned=true  → stamp, no counter consumed, persist
 *   - dashboardSpawned!=true + strict → no stamp, no consume, no persist
 *   - dashboardSpawned!=true + pending+new → stamp, consume, NOT persist
 *   - dashboardSpawned!=true + pending+reattach → no stamp
 *   - dashboardSpawned!=true + no pending → no stamp
 *
 * See change: fix-dashboard-source-mislabelling (initial matrix),
 *             fix-dashboard-spawn-correlation-by-token
 *             (persistMeta + strictCorrelation).
 */
import { describe, it, expect } from "vitest";
import { decideDashboardSource } from "../lifecycle/dashboard-source-decision.js";

describe("decideDashboardSource", () => {
  it("strong signal on first register → stamp, no counter consumed, persist", () => {
    const d = decideDashboardSource({
      dashboardSpawned: true,
      pendingCount: 0,
      isNewSession: true,
      strictCorrelation: false,
    });
    expect(d).toEqual({
      shouldStamp: true,
      consumeLegacyCounter: false,
      persistMeta: true,
    });
  });

  it("strong signal on REATTACH → stamp, no counter consumed, persist", () => {
    // Regression case: bridges reattaching after a dashboard restart
    // still re-stamp source via the strong signal.
    const d = decideDashboardSource({
      dashboardSpawned: true,
      pendingCount: 0,
      isNewSession: false,
      strictCorrelation: false,
    });
    expect(d).toEqual({
      shouldStamp: true,
      consumeLegacyCounter: false,
      persistMeta: true,
    });
  });

  it("strong signal wins over strict mode (strict only suppresses legacy fallback)", () => {
    const d = decideDashboardSource({
      dashboardSpawned: true,
      pendingCount: 1,
      isNewSession: true,
      strictCorrelation: true,
    });
    expect(d).toEqual({
      shouldStamp: true,
      consumeLegacyCounter: false,
      persistMeta: true,
    });
  });

  it("strong signal does NOT consume the legacy counter even when positive", () => {
    const d = decideDashboardSource({
      dashboardSpawned: true,
      pendingCount: 3,
      isNewSession: true,
      strictCorrelation: false,
    });
    expect(d.consumeLegacyCounter).toBe(false);
  });

  it("legacy: pending>0 + isNewSession → stamp, consume counter, NOT persist", () => {
    const d = decideDashboardSource({
      dashboardSpawned: undefined,
      pendingCount: 1,
      isNewSession: true,
      strictCorrelation: false,
    });
    expect(d).toEqual({
      shouldStamp: true,
      consumeLegacyCounter: true,
      persistMeta: false,
    });
  });

  it("legacy: pending>0 + REATTACH → no stamp", () => {
    const d = decideDashboardSource({
      dashboardSpawned: undefined,
      pendingCount: 1,
      isNewSession: false,
      strictCorrelation: false,
    });
    expect(d).toEqual({
      shouldStamp: false,
      consumeLegacyCounter: false,
      persistMeta: false,
    });
  });

  it("legacy: pending=0 + isNewSession → no stamp", () => {
    const d = decideDashboardSource({
      dashboardSpawned: undefined,
      pendingCount: 0,
      isNewSession: true,
      strictCorrelation: false,
    });
    expect(d).toEqual({
      shouldStamp: false,
      consumeLegacyCounter: false,
      persistMeta: false,
    });
  });

  it("dashboardSpawned=false explicitly → no stamp (older bridge that opted out)", () => {
    const d = decideDashboardSource({
      dashboardSpawned: false,
      pendingCount: 0,
      isNewSession: true,
      strictCorrelation: false,
    });
    expect(d).toEqual({
      shouldStamp: false,
      consumeLegacyCounter: false,
      persistMeta: false,
    });
  });

  it("strict mode suppresses legacy fallback (pending>0 + new) entirely", () => {
    const d = decideDashboardSource({
      dashboardSpawned: undefined,
      pendingCount: 1,
      isNewSession: true,
      strictCorrelation: true,
    });
    expect(d).toEqual({
      shouldStamp: false,
      consumeLegacyCounter: false,
      persistMeta: false,
    });
  });

  it("strict mode is a no-op when nothing would stamp anyway", () => {
    const d = decideDashboardSource({
      dashboardSpawned: undefined,
      pendingCount: 0,
      isNewSession: true,
      strictCorrelation: true,
    });
    expect(d).toEqual({
      shouldStamp: false,
      consumeLegacyCounter: false,
      persistMeta: false,
    });
  });
});

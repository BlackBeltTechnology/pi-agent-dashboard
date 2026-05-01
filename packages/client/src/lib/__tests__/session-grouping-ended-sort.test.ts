/**
 * Pure-function tests covering the ended-tier sort by `endedAt` desc.
 *
 * The sort itself lives inline in `SessionList.renderGroup` (per
 * design D1a — kept out of `sortSessionsByOrder` to avoid status-aware
 * behaviour leaking into the ordered-tier path). This file pins the
 * sort *contract* by replicating the same expression so a future
 * refactor that extracts it into a helper still has a single source of
 * truth for the test suite.
 *
 * See change: top-of-tier-on-status-change.
 */
import { describe, it, expect } from "vitest";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Mirror of the inline sort used in SessionList.renderGroup. */
function sortEndedTier(sessions: DashboardSession[]): DashboardSession[] {
  return [...sessions]
    .filter((s) => s.status === "ended")
    .sort(
      (a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt),
    );
}

function makeSession(
  partial: Partial<DashboardSession> & { id: string },
): DashboardSession {
  return {
    id: partial.id,
    cwd: partial.cwd ?? "/p",
    name: partial.name ?? "",
    firstMessage: partial.firstMessage ?? "",
    status: partial.status ?? "ended",
    startedAt: partial.startedAt ?? 0,
    endedAt: partial.endedAt,
    hidden: partial.hidden ?? false,
  } as unknown as DashboardSession;
}

describe("ended-tier sort by endedAt desc", () => {
  it("✕ shutdown surfaces card at top of ended tier", () => {
    // Old session (started 14h ago) just killed; recent sessions ended earlier.
    const oldJustKilled = makeSession({
      id: "old",
      startedAt: 1_000,
      endedAt: 9_000, // killed at t=9000
    });
    const recent1 = makeSession({
      id: "recent1",
      startedAt: 7_000,
      endedAt: 8_000,
    });
    const recent2 = makeSession({
      id: "recent2",
      startedAt: 6_000,
      endedAt: 7_500,
    });
    const sorted = sortEndedTier([recent2, recent1, oldJustKilled]);
    expect(sorted.map((s) => s.id)).toEqual(["old", "recent1", "recent2"]);
  });

  it("natural pi exit surfaces card at top of ended tier", () => {
    const a = makeSession({ id: "a", startedAt: 100, endedAt: 500 });
    const b = makeSession({ id: "b", startedAt: 200, endedAt: 800 }); // most recent
    const c = makeSession({ id: "c", startedAt: 300, endedAt: 600 });
    const sorted = sortEndedTier([a, b, c]);
    expect(sorted.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("legacy sessions without endedAt fall back to startedAt", () => {
    const legacy = makeSession({ id: "legacy", startedAt: 5_000 }); // no endedAt
    const recent = makeSession({ id: "recent", startedAt: 1_000, endedAt: 4_000 });
    const sorted = sortEndedTier([recent, legacy]);
    // legacy.startedAt (5000) > recent.endedAt (4000) → legacy first
    expect(sorted.map((s) => s.id)).toEqual(["legacy", "recent"]);
  });

  it("mixed legacy and modern sessions sort correctly", () => {
    const legacy1 = makeSession({ id: "L1", startedAt: 3_000 });
    const legacy2 = makeSession({ id: "L2", startedAt: 1_000 });
    const modernHi = makeSession({ id: "M1", startedAt: 2_000, endedAt: 4_000 });
    const modernLo = makeSession({ id: "M2", startedAt: 500, endedAt: 2_500 });
    const sorted = sortEndedTier([legacy2, modernLo, legacy1, modernHi]);
    expect(sorted.map((s) => s.id)).toEqual(["M1", "L1", "M2", "L2"]);
  });

  it("filters out alive sessions", () => {
    const alive = makeSession({ id: "alive", status: "active", startedAt: 1_000 });
    const ended = makeSession({ id: "ended", status: "ended", startedAt: 2_000, endedAt: 3_000 });
    const sorted = sortEndedTier([alive, ended]);
    expect(sorted.map((s) => s.id)).toEqual(["ended"]);
  });

  it("returns empty for all-alive input", () => {
    const a = makeSession({ id: "a", status: "active", startedAt: 1 });
    const sorted = sortEndedTier([a]);
    expect(sorted).toEqual([]);
  });

  it("does not mutate input array", () => {
    const ended1 = makeSession({ id: "1", endedAt: 100 });
    const ended2 = makeSession({ id: "2", endedAt: 200 });
    const input = [ended1, ended2];
    const inputBefore = [...input];
    sortEndedTier(input);
    expect(input).toEqual(inputBefore);
  });
});

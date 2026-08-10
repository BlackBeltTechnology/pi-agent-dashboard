/**
 * Status-partition render contract (replaces the removed endedAt-desc
 * ended-tier sort).
 *
 * Each folder renders a stable partition of the SINGLE stored order into
 * ACTIVE / ENDED / HIDDEN tiers: per tier, ids present in the order keep
 * their relative position; ids absent are appended by startedAt desc.
 * The partition logic lives inline in `SessionList.renderGroup` and is
 * built from `sortSessionsByOrder(tierSessions, order)`. This file mirrors
 * that expression so the contract has a single source of truth in tests.
 *
 * See change: simplify-session-card-ordering (removes endedAt-desc sort).
 */
import { describe, it, expect } from "vitest";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { sortSessionsByOrder } from "../session/session-grouping.js";

function makeSession(
  partial: Partial<DashboardSession> & { id: string },
): DashboardSession {
  return {
    id: partial.id,
    cwd: partial.cwd ?? "/p",
    name: partial.name ?? "",
    firstMessage: partial.firstMessage ?? "",
    status: partial.status ?? "active",
    startedAt: partial.startedAt ?? 0,
    endedAt: partial.endedAt,
    hidden: partial.hidden ?? false,
  } as unknown as DashboardSession;
}

/** Mirror of the inline partition in SessionList.renderGroup. */
function partition(sessions: DashboardSession[], order?: string[]) {
  const active = sortSessionsByOrder(
    sessions.filter((s) => s.status !== "ended" && !s.hidden),
    order,
  );
  const ended = sortSessionsByOrder(
    sessions.filter((s) => s.status === "ended" && !s.hidden),
    order,
  );
  const hidden = sortSessionsByOrder(
    sessions.filter((s) => s.hidden),
    order,
  );
  return {
    active: active.map((s) => s.id),
    ended: ended.map((s) => s.id),
    hidden: hidden.map((s) => s.id),
  };
}

describe("stable status-partition of the stored order", () => {
  it("active and ended derive from one flat order, relative order preserved", () => {
    // Order [E1, A1, A2, E2]; E* ended, A* active.
    const E1 = makeSession({ id: "E1", status: "ended", endedAt: 1 });
    const A1 = makeSession({ id: "A1", status: "active" });
    const A2 = makeSession({ id: "A2", status: "active" });
    const E2 = makeSession({ id: "E2", status: "ended", endedAt: 2 });
    const out = partition([E2, A1, E1, A2], ["E1", "A1", "A2", "E2"]);
    expect(out.active).toEqual(["A1", "A2"]);
    expect(out.ended).toEqual(["E1", "E2"]);
  });

  it("moveToFront of an ended id surfaces it at top of the ended tier", () => {
    // Stored ["A1","A2","E1","E2"] then E2 moved to front → ["E2",...].
    const A1 = makeSession({ id: "A1", status: "active" });
    const A2 = makeSession({ id: "A2", status: "active" });
    const E1 = makeSession({ id: "E1", status: "ended", endedAt: 1 });
    const E2 = makeSession({ id: "E2", status: "ended", endedAt: 2 });
    const out = partition([A1, A2, E1, E2], ["E2", "A1", "A2", "E1"]);
    expect(out.active).toEqual(["A1", "A2"]); // active tier unchanged
    expect(out.ended).toEqual(["E2", "E1"]); // E2 at top of ended tier
  });

  it("ids absent from the order append by startedAt desc within their tier", () => {
    const A1 = makeSession({ id: "A1", status: "active", startedAt: 100 });
    const A2 = makeSession({ id: "A2", status: "active", startedAt: 300 });
    const A3 = makeSession({ id: "A3", status: "active", startedAt: 200 });
    // Only A1 ordered; A2/A3 unordered → appended by startedAt desc.
    const out = partition([A1, A2, A3], ["A1"]);
    expect(out.active).toEqual(["A1", "A2", "A3"]);
  });

  it("hidden tier derives from the same order, separate from active/ended", () => {
    const A1 = makeSession({ id: "A1", status: "active" });
    const H1 = makeSession({ id: "H1", status: "ended", hidden: true });
    const H2 = makeSession({ id: "H2", status: "active", hidden: true });
    const out = partition([A1, H1, H2], ["H2", "A1", "H1"]);
    expect(out.active).toEqual(["A1"]);
    expect(out.hidden).toEqual(["H2", "H1"]); // hidden tier in stored order
  });

  it("no endedAt-desc reshuffle: ended tier honors stored order, not endedAt", () => {
    // E_old ended most recently (endedAt 9000) but is LAST in stored order.
    const E_recent = makeSession({ id: "E_recent", status: "ended", endedAt: 9000 });
    const E_first = makeSession({ id: "E_first", status: "ended", endedAt: 1000 });
    const out = partition([E_recent, E_first], ["E_first", "E_recent"]);
    // Stored order wins — NOT endedAt desc (which would put E_recent first).
    expect(out.ended).toEqual(["E_first", "E_recent"]);
  });
});

/**
 * Tests for session grouping after jj removal.
 * All jj-specific workspace-root/clustering tests removed.
 */
import { describe, it, expect } from "vitest";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { groupSessionsByDirectory } from "../session-grouping.js";

function mk(
  id: string,
  cwd: string,
  startedAt: number,
): DashboardSession {
  return {
    id,
    cwd,
    source: "tui",
    status: "active",
    startedAt,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
  } as DashboardSession;
}

describe("groupSessionsByDirectory", () => {
  it("sessions group by cwd (regression guard)", () => {
    const a = mk("a", "/repo", 100);
    const b = mk("b", "/other", 200);
    const { unpinned } = groupSessionsByDirectory([a, b], undefined, [], "linux");
    expect(unpinned).toHaveLength(2);
    const cwds = unpinned.map((g) => g.cwd).sort();
    expect(cwds).toEqual(["/other", "/repo"]);
  });

  it("sessions at same cwd group together", () => {
    const a = mk("a", "/repo", 100);
    const b = mk("b", "/repo", 200);
    const { unpinned } = groupSessionsByDirectory([a, b], undefined, [], "linux");
    expect(unpinned).toHaveLength(1);
    expect(unpinned[0]!.cwd).toBe("/repo");
    expect(unpinned[0]!.sessions.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });
});

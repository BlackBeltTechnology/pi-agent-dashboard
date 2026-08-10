import { describe, it, expect } from "vitest";
import { groupSessionsByDirectory } from "../session/SessionList.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function makeSession(id: string, cwd: string, startedAt: number): DashboardSession {
  return {
    id,
    cwd,
    source: "tui",
    status: "active",
    startedAt,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
  };
}

describe("groupSessionsByDirectory with order map", () => {
  it("sorts sessions within group by server order", () => {
    const sessions = [
      makeSession("s1", "/project", 1000),
      makeSession("s2", "/project", 2000),
      makeSession("s3", "/project", 3000),
    ];
    const orderMap = new Map([
      ["/project", ["s3", "s1", "s2"]],
    ]);
    const { unpinned } = groupSessionsByDirectory(sessions, orderMap);
    expect(unpinned[0].sessions.map((s: DashboardSession) => s.id)).toEqual(["s3", "s1", "s2"]);
  });

  it("appends unordered sessions by startedAt descending", () => {
    const sessions = [
      makeSession("s1", "/project", 1000),
      makeSession("s2", "/project", 2000),
      makeSession("s3", "/project", 3000),
    ];
    const orderMap = new Map([
      ["/project", ["s1"]],
    ]);
    const { unpinned } = groupSessionsByDirectory(sessions, orderMap);
    // s1 first (in order), then s3, s2 (by startedAt desc)
    expect(unpinned[0].sessions.map((s: DashboardSession) => s.id)).toEqual(["s1", "s3", "s2"]);
  });

  it("falls back to startedAt descending when no order provided", () => {
    const sessions = [
      makeSession("s1", "/project", 1000),
      makeSession("s2", "/project", 3000),
      makeSession("s3", "/project", 2000),
    ];
    const { unpinned } = groupSessionsByDirectory(sessions);
    expect(unpinned[0].sessions.map((s: DashboardSession) => s.id)).toEqual(["s2", "s3", "s1"]);
  });

  it("handles empty order map", () => {
    const sessions = [
      makeSession("s1", "/project", 1000),
      makeSession("s2", "/project", 2000),
    ];
    const { unpinned } = groupSessionsByDirectory(sessions, new Map());
    expect(unpinned[0].sessions.map((s: DashboardSession) => s.id)).toEqual(["s2", "s1"]);
  });

  it("handles multiple groups each with their own order", () => {
    const sessions = [
      makeSession("s1", "/a", 1000),
      makeSession("s2", "/a", 2000),
      makeSession("s3", "/b", 1000),
      makeSession("s4", "/b", 2000),
    ];
    const orderMap = new Map([
      ["/a", ["s1", "s2"]],
      ["/b", ["s4", "s3"]],
    ]);
    const { unpinned } = groupSessionsByDirectory(sessions, orderMap);
    const groupA = unpinned.find((g) => g.cwd === "/a")!;
    const groupB = unpinned.find((g) => g.cwd === "/b")!;
    expect(groupA.sessions.map((s: DashboardSession) => s.id)).toEqual(["s1", "s2"]);
    expect(groupB.sessions.map((s: DashboardSession) => s.id)).toEqual(["s4", "s3"]);
  });
});

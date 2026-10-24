/**
 * viewedSession decision table (test-plan #E1).
 * See change: fix-archived-session-view-header-and-stale-artifact-tab (D1).
 */
import type { ArchivedSessionSummary } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { viewedSession } from "../archived-read-only-session.js";

const live = { id: "live-1", cwd: "/live", status: "active" } as unknown as DashboardSession;
const summary = {
  id: "arch-1",
  cwd: "/repo",
  name: "Archived",
  sessionFile: "/s/arch-1.jsonl",
  endedAt: 5,
} as unknown as ArchivedSessionSummary;

const sessions = new Map<string, DashboardSession>([["live-1", live]]);
const summaries = new Map<string, ArchivedSessionSummary>([["arch-1", summary]]);

describe("viewedSession", () => {
  it("R1: a live row wins by identity", () => {
    expect(viewedSession("live-1", sessions, "arch-1", summaries)).toBe(live);
  });

  it("R2: the archived id gets a synthesized ended row with cwd + sessionFile", () => {
    const row = viewedSession("arch-1", sessions, "arch-1", summaries);
    expect(row).toMatchObject({ id: "arch-1", status: "ended", cwd: "/repo", sessionFile: "/s/arch-1.jsonl" });
  });

  it("R3: archived id without a fetched summary → undefined", () => {
    expect(viewedSession("arch-1", sessions, "arch-1", new Map())).toBeUndefined();
  });

  it("R4: not the archived-read-only id → undefined; undefined id → undefined", () => {
    expect(viewedSession("arch-1", sessions, undefined, summaries)).toBeUndefined();
    expect(viewedSession(undefined, sessions, "arch-1", summaries)).toBeUndefined();
  });
});

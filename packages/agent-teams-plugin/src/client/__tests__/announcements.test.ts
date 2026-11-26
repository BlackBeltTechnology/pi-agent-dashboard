/**
 * Snapshot diffing + throttled announcer (test-plan S30; task 7.5): status
 * changes become structured events, throttled to ONE summary per 4 s, never
 * carrying message text or task titles. The live-region DOM node itself (S91)
 * belongs to the Team view.
 * See change: add-agent-teams-ui.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamUiSnapshot } from "../../shared/ui-protocol.js";
import { ANNOUNCE_INTERVAL_MS, type AnnounceSummary, announcementLines, createAnnouncer, diffSnapshots } from "../announcements.js";
import { makeSnapshot, type SnapshotSpec } from "./fixtures.js";

const snap = (spec: SnapshotSpec = {}): TeamUiSnapshot => makeSnapshot(spec);

describe("diffSnapshots", () => {
  it("the first snapshot ever loaded is the baseline and announces nothing", () => {
    expect(diffSnapshots(undefined, snap())).toEqual([]);
  });

  it("reports member status changes, newly completed tasks and team close", () => {
    const prev = snap();
    const next = snap({ members: [["alice", "busy"], ["bob", "spawning"]], tasks: [["3", "completed"]], status: "closed" });
    expect(diffSnapshots(prev, next)).toEqual([
      { kind: "member", name: "alice", status: "busy" },
      { kind: "member", name: "bob", status: "spawning" },
      { kind: "task_completed", id: "3" },
      { kind: "team_closed" },
    ]);
  });

  it("reports nothing for an unchanged snapshot (a 304 path or a no-op rev)", () => {
    expect(diffSnapshots(snap(), snap({ rev: 9 }))).toEqual([]);
  });

  it("does not re-announce an already completed task, nor a closed team", () => {
    const done = snap({ tasks: [["3", "completed"]], status: "closed" });
    expect(diffSnapshots(done, snap({ tasks: [["3", "completed"]], status: "closed", rev: 2 }))).toEqual([]);
  });

  it("a task that first appears already completed is announced; a vanished member is not", () => {
    expect(diffSnapshots(snap({ tasks: [] }), snap({ tasks: [["4", "completed"]] }))).toEqual([{ kind: "task_completed", id: "4" }]);
    expect(diffSnapshots(snap({ members: [["alice", "idle"], ["bob", "idle"]] }), snap({ members: [["alice", "idle"]] }))).toEqual([]);
  });

  it("events carry ids, names and statuses only — never mail text, titles or the team name", () => {
    const events = diffSnapshots(snap(), snap({ members: [["alice", "busy"]], tasks: [["3", "completed"]], status: "closed" }));
    expect(JSON.stringify(events)).not.toContain("SECRET-7f3a");
  });
});

describe("createAnnouncer (S30)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const out: Array<{ at: number; summary: AnnounceSummary }> = [];
    const a = createAnnouncer((summary) => out.push({ at: Date.now() - t0, summary }));
    const t0 = Date.now();
    return { a, out, t0 };
  };

  it("announces at t=0, defers t=3 999, and ONE summary at 4 000 covers both later changes", () => {
    const { a, out, t0 } = setup();
    a.push([{ kind: "member", name: "alice", status: "busy" }]);
    expect(out).toHaveLength(1);
    expect(out[0]?.summary.members).toEqual([{ name: "alice", status: "busy" }]);

    vi.advanceTimersByTime(3999);
    a.push([{ kind: "task_completed", id: "3" }]);
    expect(out).toHaveLength(1);

    // The close arrives exactly at 4 000 ms, before the trailing timer callback ran.
    vi.setSystemTime(t0 + 4000);
    a.push([{ kind: "team_closed" }]);
    expect(out).toHaveLength(2);
    expect(out[1]?.summary).toEqual({ members: [], tasksCompleted: ["3"], teamClosed: true });
    expect(ANNOUNCE_INTERVAL_MS).toBe(4000);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(30_000);
    expect(out).toHaveLength(2);
    a.dispose();
  });

  it("a deferred change is flushed by the timer at the interval end even with no further push", () => {
    const { a, out } = setup();
    a.push([{ kind: "team_closed" }]);
    a.push([{ kind: "task_completed", id: "1" }]);
    expect(out).toHaveLength(1);
    vi.advanceTimersByTime(3999);
    expect(out).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(out).toHaveLength(2);
    expect(out[1]?.summary.tasksCompleted).toEqual(["1"]);
    a.dispose();
  });

  it("10 changes in 2 s produce at most one announcement per 4 s window", () => {
    const { a, out } = setup();
    for (let i = 0; i < 10; i++) {
      a.push([{ kind: "member", name: `m${i}`, status: "busy" }]);
      vi.advanceTimersByTime(200);
    }
    expect(out).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(out).toHaveLength(2);
    expect(out[1]?.summary.members).toHaveLength(9);
    vi.advanceTimersByTime(60_000);
    expect(out).toHaveLength(2);
    a.dispose();
  });

  it("keeps only the latest status per member inside one summary", () => {
    const { a, out } = setup();
    a.push([{ kind: "task_completed", id: "9" }]);
    a.push([{ kind: "member", name: "alice", status: "busy" }]);
    a.push([{ kind: "member", name: "alice", status: "idle" }]);
    vi.advanceTimersByTime(4000);
    expect(out[1]?.summary.members).toEqual([{ name: "alice", status: "idle" }]);
    a.dispose();
  });

  it("dispose clears the pending timer and drops the deferred summary", () => {
    const { a, out } = setup();
    a.push([{ kind: "team_closed" }]);
    a.push([{ kind: "task_completed", id: "2" }]);
    a.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(out).toHaveLength(1);
  });

  it("an empty push announces nothing and starts no timer", () => {
    const { a, out } = setup();
    a.push([]);
    expect(out).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("announcementLines", () => {
  it("expands a summary into i18n keys + vars (ids and names only)", () => {
    expect(announcementLines({ members: [{ name: "alice", status: "busy" }, { name: "bob", status: "weird" }], tasksCompleted: ["3", "4"], teamClosed: true })).toEqual([
      { key: "announce.member.busy", vars: { name: "alice" } },
      { key: "announce.member.unknown", vars: { name: "bob" } },
      { key: "announce.task_completed", vars: { id: "3" } },
      { key: "announce.task_completed", vars: { id: "4" } },
      { key: "announce.team_closed" },
    ]);
  });
});

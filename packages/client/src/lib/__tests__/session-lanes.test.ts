/**
 * Pure lane logic for session-list Group-by. See change: session-list-group-by.
 */
import type { GroupByPrefs } from "@blackbelt-technology/pi-dashboard-shared/session-group-by.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import {
  classifyLocationLane,
  classifyStatusLane,
  completeStoredOrder,
  isLaneCollapsed,
  laneFingerprint,
  mergeLaneOrder,
  partitionIntoLanes,
  resolveEffectiveGroupBy,
  resolveLaneDrop,
} from "../session/session-lanes.js";

function mk(id: string, over: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id,
    cwd: "/repo",
    source: "tui",
    status: "idle",
    startedAt: 0,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    ...over,
  } as DashboardSession;
}

describe("classifyStatusLane", () => {
  it("error wins over everything", () => {
    expect(classifyStatusLane(mk("a", { status: "streaming", currentTool: "ask_user" }), { hasError: true })).toBe("error");
  });
  it("chat-routed ask_user → needs-you, even while streaming", () => {
    expect(classifyStatusLane(mk("a", { status: "streaming", currentTool: "ask_user" }))).toBe("needs-you");
  });
  it("widget-bar ask_user is suppressed from needs-you", () => {
    expect(classifyStatusLane(mk("a", { status: "streaming", currentTool: "ask_user" }), { hasWidgetBarPrompt: true })).toBe("working");
  });
  it("streaming / resuming / retrying / compacting → working", () => {
    expect(classifyStatusLane(mk("a", { status: "streaming" }))).toBe("working");
    expect(classifyStatusLane(mk("a", { resuming: true }))).toBe("working");
    expect(classifyStatusLane(mk("a"), { isRetrying: true })).toBe("working");
    expect(classifyStatusLane(mk("a", { compacting: true }))).toBe("working");
  });
  it("notice → review; unread idle → review; read idle → idle", () => {
    expect(classifyStatusLane(mk("a"), { hasNotice: true })).toBe("review");
    expect(classifyStatusLane(mk("a", { unread: true }))).toBe("review");
    expect(classifyStatusLane(mk("a", { status: "active" }))).toBe("idle");
    expect(classifyStatusLane(mk("a"))).toBe("idle");
  });
  it("compacting outranks notice / unread (spec rule 3 before 4)", () => {
    expect(classifyStatusLane(mk("a", { compacting: true }), { hasNotice: true })).toBe("working");
    expect(classifyStatusLane(mk("a", { compacting: true, unread: true }))).toBe("working");
  });
  it("ended is excluded (null), even with a notice", () => {
    expect(classifyStatusLane(mk("a", { status: "ended" }))).toBeNull();
    expect(classifyStatusLane(mk("a", { status: "ended" }), { hasNotice: true })).toBeNull();
  });
});

describe("classifyLocationLane", () => {
  it("worktree sessions → worktrees, others → main", () => {
    expect(classifyLocationLane(mk("a", { gitWorktree: { mainPath: "/repo", name: "x" } }))).toBe("worktrees");
    expect(classifyLocationLane(mk("a"))).toBe("main");
  });
});

describe("partitionIntoLanes", () => {
  it("none ⇒ single lane in stored order", () => {
    const lanes = partitionIntoLanes([mk("a"), mk("b")], "none", ["b", "a"]);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].laneId).toBeNull();
    expect(lanes[0].sessions.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("status lanes in fixed order, empty lanes omitted, relative stored order kept", () => {
    const ss = [
      mk("idle1"),
      mk("work1", { status: "streaming" }),
      mk("idle2"),
      mk("need", { currentTool: "ask_user" }),
      mk("rev", { unread: true }),
      mk("work2", { status: "streaming" }),
      mk("gone", { status: "ended" }),
    ];
    const lanes = partitionIntoLanes(ss, "status", ["work2", "idle2", "rev", "need", "work1", "idle1"]);
    expect(lanes.map((l) => l.laneId)).toEqual(["needs-you", "working", "review", "idle"]);
    expect(lanes.map((l) => l.sessions.map((s) => s.id))).toEqual([["need"], ["work2", "work1"], ["rev"], ["idle2", "idle1"]]);
  });

  it("unordered sessions appended by startedAt desc", () => {
    const lanes = partitionIntoLanes([mk("old", { startedAt: 1 }), mk("new", { startedAt: 9 }), mk("o")], "location", ["o"]);
    expect(lanes[0].sessions.map((s) => s.id)).toEqual(["o", "new", "old"]);
  });

  it("location: main before worktrees", () => {
    const wt = { mainPath: "/repo", name: "x" };
    const lanes = partitionIntoLanes([mk("w", { gitWorktree: wt }), mk("m")], "location", ["w", "m"]);
    expect(lanes.map((l) => l.laneId)).toEqual(["main", "worktrees"]);
  });

  it("assign override is honored (hysteresis-adjusted)", () => {
    const lanes = partitionIntoLanes([mk("a"), mk("b")], "status", ["a", "b"], (s) => (s.id === "a" ? "working" : "idle"));
    expect(lanes.map((l) => [l.laneId, l.sessions.map((s) => s.id)])).toEqual([["working", ["a"]], ["idle", ["b"]]]);
  });
});

describe("mergeLaneOrder", () => {
  it("refills the lane's slots, others keep positions", () => {
    expect(mergeLaneOrder(["a", "X", "b", "Y", "c"], ["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "X", "a", "Y", "b"]);
  });
  it("appends lane ids missing from the stored order, in lane order", () => {
    expect(mergeLaneOrder(["a", "X"], ["a", "n"], ["n", "a"])).toEqual(["n", "X", "a"]);
  });
  it("identity when order unchanged", () => {
    expect(mergeLaneOrder(["a", "X", "b"], ["a", "b"], ["a", "b"])).toEqual(["a", "X", "b"]);
  });
});

describe("resolveEffectiveGroupBy / isLaneCollapsed", () => {
  const prefs: GroupByPrefs = {
    defaultGroupBy: "status",
    folderGroupBy: { "/repo/": "location" },
    collapsedLanes: ["/repo/::idle"],
  };
  it("override > default > none, canonical lookup", () => {
    expect(resolveEffectiveGroupBy("/repo", prefs, "linux")).toBe("location");
    expect(resolveEffectiveGroupBy("/other", prefs, "linux")).toBe("status");
    expect(resolveEffectiveGroupBy("/other", { ...prefs, defaultGroupBy: "none" }, "linux")).toBe("none");
    expect(resolveEffectiveGroupBy("/repo", undefined, "linux")).toBe("none");
  });
  it("lane collapse lookup folds key spellings", () => {
    expect(isLaneCollapsed("/repo", "idle", prefs, "linux")).toBe(true);
    expect(isLaneCollapsed("/repo", "working", prefs, "linux")).toBe(false);
    expect(isLaneCollapsed("/repo", "idle", undefined, "linux")).toBe(false);
  });
});

describe("laneFingerprint", () => {
  it("ignores token/cost churn, changes on lane-relevant fields", () => {
    const a = laneFingerprint([mk("a")], () => ({}));
    expect(laneFingerprint([mk("a", { tokensIn: 99, cost: 3 })], () => ({}))).toBe(a);
    expect(laneFingerprint([mk("a", { unread: true })], () => ({}))).not.toBe(a);
    expect(laneFingerprint([mk("a")], () => ({ hasError: true }))).not.toBe(a);
  });
});

describe("resolveLaneDrop", () => {
  const base = { storedIds: ["a", "X", "b", "e"], laneIds: ["a", "b"] };
  it("cross-lane drop is rejected (order untouched)", () => {
    expect(resolveLaneDrop({ ...base, activeId: "a", overId: "X", activeLane: "idle", overLane: "working" })).toEqual({ kind: "reject" });
  });
  it("within-lane drop merges into the stored order by slot", () => {
    expect(resolveLaneDrop({ ...base, activeId: "b", overId: "a", activeLane: "working", overLane: "working" })).toEqual({
      kind: "reorder",
      order: ["b", "X", "a", "e"],
    });
  });
  it("ended bucket involved → flat path (drag-to-resume)", () => {
    expect(resolveLaneDrop({ ...base, activeId: "e", overId: "a", activeLane: undefined, overLane: "idle" })).toEqual({ kind: "flat" });
  });
});

describe("completeStoredOrder", () => {
  it("keeps paged-out ids from the stored order and appends unordered loaded ids", () => {
    expect(completeStoredOrder(["a", "gone", "b"], ["b", "a", "new"])).toEqual(["a", "gone", "b", "new"]);
    expect(completeStoredOrder(undefined, ["x"])).toEqual(["x"]);
  });
});

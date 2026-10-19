/**
 * `deriveSessionMenu` — the pure derivation behind the session actions menu.
 * See change: add-session-actions-flyout (test-plan E1–E12, E14).
 */
import { ChangeState, type DashboardSession, deriveChangeState as deriveChangeStateForTest, type OpenSpecChange, type OpenSpecReadiness } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it, vi } from "vitest";
import { deriveOpenSpecActions } from "../../../components/openspec/openspec-actions.js";
import { buildArchiveArtifactUrl } from "../../nav/route-builders.js";
import {
  deriveSessionMenu,
  openspecGroupMode,
  partitionRare,
  type SessionMenuActions,
  type SessionMenuCtx,
  type SessionMenuGroup,
} from "../session-menu-items.js";

const noop = () => undefined;

function actions(over: Partial<SessionMenuActions> = {}): SessionMenuActions {
  return {
    resume: vi.fn(),
    spawnSibling: vi.fn(),
    spawnWorktree: vi.fn(),
    rename: vi.fn(),
    archiveSession: vi.fn(),
    exit: vi.fn(),
    openDialog: vi.fn(),
    sendSkill: vi.fn(),
    detach: vi.fn(),
    readArtifact: vi.fn(),
    navigate: vi.fn(),
    push: vi.fn(),
    openPr: vi.fn(),
    openUrl: vi.fn(),
    openCardSections: vi.fn(),
    openCardDefaults: vi.fn(),
    ...over,
  };
}

const ALL = ["new", "continue", "ff", "apply", "verify", "archive", "explore", "propose", "bulk-archive"];

function change(over: Partial<OpenSpecChange> = {}): OpenSpecChange {
  return {
    name: "add-auth",
    status: "in-progress",
    completedTasks: 1,
    totalTasks: 3,
    isComplete: true,
    artifacts: [
      { id: "proposal", status: "done" },
      { id: "design", status: "done" },
      { id: "specs", status: "done" },
      { id: "tasks", status: "done" },
    ],
    ...over,
  };
}

function makeSession(over: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/repo/.worktrees/feat",
    source: "dashboard",
    status: "idle",
    startedAt: 1,
    gitWorktree: { mainPath: "/repo", name: "feat", base: "main" },
    gitBranch: "feat",
    attachedProposal: "add-auth",
    ...over,
  } as DashboardSession;
}

function makeCtx(session: DashboardSession, over: Partial<SessionMenuCtx> = {}): SessionMenuCtx {
  const ch = change();
  return {
    working: false,
    mergeIsPrimary: false,
    isHidden: false,
    showSpawn: true,
    canRename: session.status !== "ended",
    canArchive: true,
    canExit: true,
    openspecWired: true,
    changes: [ch],
    readiness: { state: "READY" },
    wf: (w) => ALL.includes(w),
    resolution: session.attachedProposal ? { kind: "active", change: ch, cwd: session.cwd } : null,
    canBulkArchive: true,
    ghAvailable: true,
    dirtyCount: 0,
    actions: actions(),
    ...over,
  };
}

const ids = (g: SessionMenuGroup | undefined) => g?.items.map((i) => i.id) ?? [];
const find = (groups: SessionMenuGroup[], id: string) => groups.find((g) => g.id === id);
const allItems = (groups: SessionMenuGroup[]) => groups.flatMap((g) => g.items);
const emphasised = (groups: SessionMenuGroup[]) => allItems(groups).filter((i) => i.emphasis);

describe("deriveSessionMenu — taxonomy (E1)", () => {
  it("orders groups NEXT, SESSION, OPENSPEC, GIT, VIEW and derives no PLUGINS group", () => {
    const s = makeSession();
    const groups = deriveSessionMenu(s, makeCtx(s));
    expect(groups.map((g) => g.id)).toEqual(["next", "session", "openspec", "git", "view"]);
    expect(groups.some((g) => (g.id as string) === "plugins")).toBe(false);
  });

  it("omits empty groups", () => {
    const s = makeSession({ gitWorktree: undefined, gitBranch: undefined, attachedProposal: undefined });
    const groups = deriveSessionMenu(s, makeCtx(s, { readiness: { state: "OPTED_OUT" } }));
    expect(groups.map((g) => g.id)).toEqual(["session", "view"]);
  });

  it("titles OPENSPEC with the change name and GIT with the branch", () => {
    const s = makeSession();
    const groups = deriveSessionMenu(s, makeCtx(s));
    expect(find(groups, "openspec")?.subtitle).toBe("add-auth");
    expect(find(groups, "git")?.subtitle).toBe("feat");
  });
});

describe("deriveSessionMenu — NEXT (E2, E3)", () => {
  const states: Array<[string, Partial<OpenSpecChange>, string[], string]> = [
    ["PLANNING", { artifacts: [{ id: "proposal", status: "done" }, { id: "design", status: "ready" }], status: "no-tasks" }, ["new", "continue", "ff"], "openspec-continue"],
    ["PLANNING without continue", { artifacts: [{ id: "proposal", status: "ready" }], status: "no-tasks" }, ["new", "ff"], "openspec-ff"],
    ["READY", { status: "no-tasks", completedTasks: 0 }, ALL, "openspec-apply"],
    ["IMPLEMENTING", {}, ALL, "openspec-apply"],
    ["COMPLETE", { status: "complete", completedTasks: 3 }, ALL, "openspec-archive"],
    ["COMPLETE without archive", { status: "complete", completedTasks: 3 }, ALL.filter((w) => w !== "archive"), "openspec-verify"],
  ];
  for (const [label, over, wfs, expected] of states) {
    it(`${label}: NEXT = ${expected}, never more than one emphasised item`, () => {
      const s = makeSession();
      const ch = change(over);
      const groups = deriveSessionMenu(s, makeCtx(s, { changes: [ch], resolution: { kind: "active", change: ch, cwd: s.cwd }, wf: (w) => wfs.includes(w) }));
      expect(ids(find(groups, "next"))).toEqual([expected]);
      expect(emphasised(groups)).toHaveLength(1);
      // not repeated in its home group
      expect(ids(find(groups, "openspec"))).not.toContain(expected);
    });
  }

  it("labels the Archive primary 'Archive change'", () => {
    const s = makeSession();
    const ch = change({ status: "complete", completedTasks: 3 });
    const groups = deriveSessionMenu(s, makeCtx(s, { changes: [ch], resolution: { kind: "active", change: ch, cwd: s.cwd } }));
    expect(find(groups, "next")?.items[0].label).toBe("Archive change");
  });

  it("an ended session has no NEXT", () => {
    const s = makeSession({ status: "ended" });
    const groups = deriveSessionMenu(s, makeCtx(s));
    expect(find(groups, "next")).toBeUndefined();
  });

  it("a working session renders the NEXT item aria-disabled with a reason and not emphasised", () => {
    const s = makeSession({ status: "streaming" });
    const groups = deriveSessionMenu(s, makeCtx(s, { working: true }));
    const next = find(groups, "next")?.items[0];
    expect(next?.disabled).toBe(true);
    expect(next?.reason).toBe("Session is streaming");
    expect(next?.emphasis).toBeFalsy();
  });

  it("Merge wins NEXT and the OpenSpec primary stays in OPENSPEC without emphasis (E3)", () => {
    const s = makeSession({ gitPrNumber: 4, gitPrState: "open", gitPrDraft: false, gitPrChecks: "passing", gitPrCheckedAt: Date.now() });
    const ch = change({ status: "complete", completedTasks: 3 });
    const groups = deriveSessionMenu(s, makeCtx(s, { mergeIsPrimary: true, changes: [ch], resolution: { kind: "active", change: ch, cwd: s.cwd } }));
    expect(ids(find(groups, "next"))).toEqual(["merge"]);
    const archive = find(groups, "openspec")?.items.find((i) => i.id === "openspec-archive");
    expect(archive?.label).toBe("Archive change");
    expect(archive?.emphasis).toBeFalsy();
    expect(emphasised(groups)).toHaveLength(1);
    expect(ids(find(groups, "git"))).not.toContain("merge");
  });
});

describe("deriveSessionMenu — More… folding (E4)", () => {
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `r${i}`, label: `r${i}`, rare: true as const }));
  it.each([
    [0, 0],
    [1, 0],
    [2, 2],
    [4, 4],
  ])("%i rare item(s) hide %i behind More…", (rare, hidden) => {
    const items = [{ id: "a", label: "a" }, ...mk(rare)];
    const part = partitionRare(items);
    expect(part.hidden).toHaveLength(hidden);
    expect(part.inline).toHaveLength(items.length - hidden);
  });

  it("the OPENSPEC rare set is Fast-forward, Explore…, Archive anyway…, Detach (as the state offers them)", () => {
    const s = makeSession();
    const rareOf = (ch: OpenSpecChange) =>
      find(deriveSessionMenu(s, makeCtx(s, { changes: [ch], resolution: { kind: "active", change: ch, cwd: s.cwd } })), "openspec")
        ?.items.filter((i) => i.rare)
        .map((i) => i.id);
    // IMPLEMENTING + every task ticked/artifacts done: Archive anyway is offered
    expect(rareOf(change())).toEqual(["openspec-archiveAnyway", "openspec-explore", "openspec-detach"]);
    // PLANNING: Fast-forward is offered behind the Continue primary
    expect(rareOf(change({ status: "no-tasks", artifacts: [{ id: "proposal", status: "done" }, { id: "design", status: "ready" }] }))).toEqual([
      "openspec-ff",
      "openspec-explore",
      "openspec-detach",
    ]);
  });

  it("a single rare item (Detach on an ended session) renders inline", () => {
    const s = makeSession({ status: "ended" });
    const g = find(deriveSessionMenu(s, makeCtx(s)), "openspec");
    expect(partitionRare(g?.items ?? []).hidden).toHaveLength(0);
    expect(ids(g)).toContain("openspec-detach");
  });
});

describe("deriveSessionMenu — attachment kinds (E5)", () => {
  it("archived: letters + Detach, no workflow item, no OpenSpec NEXT", () => {
    const s = makeSession();
    const entry = { name: "2026-01-01-add-auth", date: "2026-01-01", artifacts: [{ id: "proposal", status: "done" as const }, { id: "design", status: "done" as const }, { id: "tasks", status: "done" as const }] };
    const navigate = vi.fn();
    const groups = deriveSessionMenu(s, makeCtx(s, { resolution: { kind: "archived", entry, cwd: "/repo" }, actions: actions({ navigate }) }));
    expect(find(groups, "next")).toBeUndefined();
    expect(ids(find(groups, "openspec"))).toEqual(["openspec-letter-proposal", "openspec-letter-design", "openspec-letter-tasks", "openspec-detach"]);
    find(groups, "openspec")?.items[0].onSelect?.();
    expect(navigate).toHaveBeenCalledWith(buildArchiveArtifactUrl("/repo", "2026-01-01-add-auth", "proposal"));
  });

  it("main checkout: letters route to the preview in the resolved cwd", () => {
    const s = makeSession();
    const navigate = vi.fn();
    const ch = change();
    const groups = deriveSessionMenu(s, makeCtx(s, { resolution: { kind: "active", change: ch, cwd: "/repo" }, actions: actions({ navigate }) }));
    expect(ids(find(groups, "openspec"))).toContain("openspec-letter-design");
    expect(ids(find(groups, "openspec"))).not.toContain("openspec-apply");
    expect(find(groups, "next")).toBeUndefined();
    find(groups, "openspec")?.items.find((i) => i.id === "openspec-letter-design")?.onSelect?.();
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("/openspec/add-auth/design"));
  });

  it.each([["missing", { kind: "missing" as const }], ["unresolved", { kind: "unresolved" as const, reason: "loading" as const }]])("%s: Detach only", (_n, resolution) => {
    const s = makeSession();
    const groups = deriveSessionMenu(s, makeCtx(s, { resolution }));
    expect(ids(find(groups, "openspec"))).toEqual(["openspec-detach"]);
    expect(find(groups, "next")).toBeUndefined();
  });
});

describe("deriveSessionMenu — unattached (E6)", () => {
  const base = { attachedProposal: undefined, gitWorktree: undefined, gitBranch: undefined } as Partial<DashboardSession>;
  it("active session with all workflows: Attach, New change…, Propose…, Explore…", () => {
    const s = makeSession(base);
    const groups = deriveSessionMenu(s, makeCtx(s, { resolution: null }));
    expect(ids(find(groups, "openspec"))).toEqual(["openspec-attach", "openspec-new", "openspec-propose", "openspec-explore"]);
  });

  it("core workflows only hide the gated items", () => {
    const s = makeSession(base);
    const groups = deriveSessionMenu(s, makeCtx(s, { resolution: null, wf: (w) => ["new", "continue", "apply"].includes(w) }));
    expect(ids(find(groups, "openspec"))).toEqual(["openspec-attach", "openspec-new"]);
  });

  it("ended session gets Attach only", () => {
    const s = makeSession({ ...base, status: "ended" });
    const groups = deriveSessionMenu(s, makeCtx(s, { resolution: null }));
    expect(ids(find(groups, "openspec"))).toEqual(["openspec-attach"]);
  });

  it("Bulk archive… appears only with ≥1 completed change", () => {
    const s = makeSession(base);
    const none = deriveSessionMenu(s, makeCtx(s, { resolution: null, changes: [change()] }));
    expect(ids(find(none, "openspec"))).not.toContain("openspec-bulk-archive");
    const some = deriveSessionMenu(s, makeCtx(s, { resolution: null, changes: [change({ status: "complete" })] }));
    expect(ids(find(some, "openspec"))).toContain("openspec-bulk-archive");
  });

  it("Attach is disabled with a reason when there are no changes", () => {
    const s = makeSession(base);
    const g = find(deriveSessionMenu(s, makeCtx(s, { resolution: null, changes: [] })), "openspec");
    expect(g?.items[0].disabled).toBe(true);
    expect(g?.items[0].reason).toBe("No changes");
  });
});

describe("deriveSessionMenu — readiness gate (E7)", () => {
  const states: Array<[OpenSpecReadiness["state"] | "absent-field", boolean, string[]]> = [
    ["GLOBAL_OFF", true, []],
    ["OPTED_OUT", true, []],
    ["ABSENT", false, []],
    ["PENDING", true, []],
    ["BROKEN", true, ["openspec-detach"]],
    ["BROKEN", false, []],
    ["STALE", true, ["openspec-detach"]],
  ];
  for (const [state, attached, expected] of states) {
    it(`${state} × attached=${attached}`, () => {
      const s = makeSession(attached ? {} : { attachedProposal: undefined });
      const groups = deriveSessionMenu(s, makeCtx(s, { readiness: { state } as OpenSpecReadiness, resolution: attached ? { kind: "active", change: change(), cwd: s.cwd } : null }));
      expect(ids(find(groups, "openspec"))).toEqual(expected);
      if (expected.length === 0) expect(find(groups, "openspec")).toBeUndefined();
      // BROKEN / STALE never contribute a NEXT item
      if (state === "BROKEN" || state === "STALE" || state === "PENDING") expect(find(groups, "next")).toBeUndefined();
    });
  }

  it("READY gives the full group", () => {
    const s = makeSession();
    expect(find(deriveSessionMenu(s, makeCtx(s)), "openspec")?.items.length).toBeGreaterThan(3);
  });

  it("a missing readiness field degrades like the subcard's legacy heuristic", () => {
    const s = makeSession();
    expect(openspecGroupMode({ openspecWired: true, readiness: undefined, hasDir: false, pending: false }, false, false)).toBe("none");
    expect(openspecGroupMode({ openspecWired: true, readiness: undefined, hasDir: true }, false, false)).toBe("full");
    expect(openspecGroupMode({ openspecWired: true, readiness: undefined, initialized: false, pending: true }, false, false)).toBe("full");
    // an attached session keeps its trace
    expect(openspecGroupMode({ openspecWired: true, readiness: undefined, hasDir: false }, true, false)).toBe("full");
    expect(find(deriveSessionMenu(s, makeCtx(s, { readiness: undefined, hasDir: true })), "openspec")).toBeDefined();
  });

  it("an ABSENT cwd keeps Detach for a non-live attachment (removed worktree)", () => {
    expect(openspecGroupMode({ openspecWired: true, readiness: { state: "ABSENT" } }, true, false)).toBe("full");
    expect(openspecGroupMode({ openspecWired: true, readiness: { state: "ABSENT" } }, true, true)).toBe("none");
  });

  it("no OpenSpec handlers wired → no group", () => {
    const s = makeSession();
    expect(find(deriveSessionMenu(s, makeCtx(s, { openspecWired: false })), "openspec")).toBeUndefined();
  });
});

describe("deriveSessionMenu — Resume / Fork availability (E8)", () => {
  const sf = { sessionFile: "/x/s.jsonl" };
  const sessionIds = (s: DashboardSession, over: Partial<SessionMenuCtx> = {}) => ids(find(deriveSessionMenu(s, makeCtx(s, over)), "session"));

  it("Resume only for ended or hidden sessions with a sessionFile; Fork for any local sessionFile", () => {
    expect(sessionIds(makeSession({ ...sf, status: "ended" }))).toEqual(expect.arrayContaining(["resume", "fork"]));
    expect(sessionIds(makeSession({ ...sf }), { isHidden: true })).toEqual(expect.arrayContaining(["resume", "fork"]));
    const live = sessionIds(makeSession({ ...sf }));
    expect(live).toContain("fork");
    expect(live).not.toContain("resume");
    const none = sessionIds(makeSession({ status: "ended" }));
    expect(none).not.toContain("resume");
    expect(none).not.toContain("fork");
  });

  it("neither renders for remote-origin or ACP sessions", () => {
    const remote = sessionIds(makeSession({ ...sf, status: "ended", originDeviceId: "laptop" } as Partial<DashboardSession>));
    expect(remote).not.toContain("resume");
    expect(remote).not.toContain("fork");
    const acp = sessionIds(makeSession({ ...sf, status: "ended", driver: "acp" } as Partial<DashboardSession>));
    expect(acp).not.toContain("fork");
  });

  it("resuming disables both; cwdMissing disables both with the reason text", () => {
    const s1 = find(deriveSessionMenu(makeSession({ ...sf, status: "ended", resuming: true }), makeCtx(makeSession({ ...sf, status: "ended", resuming: true }))), "session");
    expect(s1?.items.filter((i) => i.id === "resume" || i.id === "fork").every((i) => i.disabled)).toBe(true);
    const gone = makeSession({ ...sf, status: "ended", cwdMissing: true, gitWorktree: undefined, isGitRepo: true });
    const g = find(deriveSessionMenu(gone, makeCtx(gone)), "session");
    for (const id of ["resume", "fork", "spawn-sibling", "spawn-worktree"]) {
      const item = g?.items.find((i) => i.id === id);
      expect(item?.disabled, id).toBe(true);
      expect(item?.reason, id).toBe("session's directory no longer exists");
    }
  });
});

describe("deriveSessionMenu — New worktree session gate (E9) and spawn visibility (E12)", () => {
  const worktreeItem = (s: DashboardSession, over: Partial<SessionMenuCtx> = {}) =>
    find(deriveSessionMenu(s, makeCtx(s, over)), "session")?.items.some((i) => i.id === "spawn-worktree");

  it.each([
    [true, undefined, true, true],
    [true, undefined, false, false],
    [true, undefined, undefined, true],
    [true, { mainPath: "/repo", name: "x" }, true, false],
  ])("handler=%s gitWorktree=%j isGitRepo=%s → %s", (handler, gitWorktree, isGitRepo, expected) => {
    const s = makeSession({ gitWorktree: gitWorktree as DashboardSession["gitWorktree"], isGitRepo });
    expect(worktreeItem(s, { actions: actions(handler ? {} : { spawnWorktree: undefined }) })).toBe(expected);
  });

  it("no handler (gitWorktreeEnabled=false) → no item", () => {
    const s = makeSession({ gitWorktree: undefined, isGitRepo: true });
    expect(worktreeItem(s, { actions: actions({ spawnWorktree: undefined }) })).toBe(false);
  });

  it("hiding `spawn` removes both spawn items but keeps OPENSPEC and GIT groups", () => {
    const s = makeSession({ gitWorktree: undefined, isGitRepo: true });
    const groups = deriveSessionMenu(s, makeCtx(s, { showSpawn: false }));
    const sessionIds = ids(find(groups, "session"));
    expect(sessionIds).not.toContain("spawn-sibling");
    expect(sessionIds).not.toContain("spawn-worktree");
    expect(find(groups, "openspec")).toBeDefined();
    expect(find(groups, "git")).toBeDefined();
  });

  it("keeps the legacy test ids", () => {
    const s = makeSession({ gitWorktree: undefined, isGitRepo: true });
    const items = find(deriveSessionMenu(s, makeCtx(s)), "session")?.items ?? [];
    expect(items.find((i) => i.id === "spawn-sibling")?.testId).toBe("session-card-spawn-sibling");
    expect(items.find((i) => i.id === "spawn-worktree")?.testId).toBe("session-card-spawn-worktree");
  });
});

describe("deriveSessionMenu — Rename / Archive / labels (E10)", () => {
  it("Rename… only when live, Archive session iff canArchive", () => {
    const live = makeSession();
    expect(ids(find(deriveSessionMenu(live, makeCtx(live)), "session"))).toContain("rename");
    const ended = makeSession({ status: "ended" });
    const endedIds = ids(find(deriveSessionMenu(ended, makeCtx(ended)), "session"));
    expect(endedIds).not.toContain("rename");
    expect(endedIds).toContain("archive-session");
    expect(ids(find(deriveSessionMenu(live, makeCtx(live, { canArchive: false })), "session"))).not.toContain("archive-session");
  });

  it("'Archive session' and 'Archive change' are both present and distinct", () => {
    const s = makeSession();
    const ch = change({ status: "complete", completedTasks: 3 });
    const groups = deriveSessionMenu(s, makeCtx(s, { changes: [ch], resolution: { kind: "active", change: ch, cwd: s.cwd } }));
    const labels = allItems(groups).map((i) => i.label);
    expect(labels).toContain("Archive session");
    expect(labels).toContain("Archive change");
  });

  it("Exit renders for alive sessions only", () => {
    const live = makeSession();
    expect(ids(find(deriveSessionMenu(live, makeCtx(live)), "session"))).toContain("exit");
    const ended = makeSession({ status: "ended" });
    expect(ids(find(deriveSessionMenu(ended, makeCtx(ended)), "session"))).not.toContain("exit");
  });
});

describe("deriveSessionMenu — working disables worktree mutations (E11)", () => {
  it.each(["streaming", "retrying"])("%s: Push, Open PR and Merge are disabled with a reason; Close stays enabled", (status) => {
    const s = makeSession({ status: status === "retrying" ? "idle" : "streaming" });
    const g = find(deriveSessionMenu(s, makeCtx(s, { working: true })), "git");
    for (const id of ["push", "open-pr", "merge"]) {
      const item = g?.items.find((i) => i.id === id);
      expect(item?.disabled, id).toBe(true);
      expect(item?.reason, id).toBe("Session is streaming");
    }
    expect(g?.items.find((i) => i.id === "close-worktree")?.disabled).toBeFalsy();
  });

  it("offers Commit N changes… when dirty and View PR #N when a PR exists", () => {
    const s = makeSession({ gitPrNumber: 7, gitPrUrl: "https://gh/pr/7", gitPrState: "open" });
    const openUrl = vi.fn();
    const g = find(deriveSessionMenu(s, makeCtx(s, { dirtyCount: 3, actions: actions({ openUrl }) })), "git");
    expect(g?.items[0].label).toBe("Commit 3 changes…");
    const view = g?.items.find((i) => i.id === "view-pr");
    expect(view?.label).toBe("View PR #7");
    view?.onSelect?.();
    expect(openUrl).toHaveBeenCalledWith("https://gh/pr/7");
    expect(g?.items.some((i) => i.id === "open-pr")).toBe(false);
  });

  it("a PR with no known URL offers no View PR item (no dead end) and no Open PR", () => {
    const s = makeSession({ gitPrNumber: 7, gitPrState: "open" });
    const g = find(deriveSessionMenu(s, makeCtx(s)), "git");
    expect(g?.items.some((i) => i.id === "view-pr")).toBe(false);
    expect(g?.items.some((i) => i.id === "open-pr")).toBe(false);
  });
});

describe("deriveSessionMenu — lifecycle row mirrors the stepper (E14)", () => {
  it("segments carry states, and inert ones have no action", () => {
    const s = makeSession();
    const ch = change({ totalTasks: 0, completedTasks: 0, status: "no-tasks", artifacts: [{ id: "proposal", status: "done" }, { id: "design", status: "done" }, { id: "specs", status: "skipped" }, { id: "tasks", status: "done" }] });
    const readArtifact = vi.fn();
    const groups = deriveSessionMenu(s, makeCtx(s, { changes: [ch], resolution: { kind: "active", change: ch, cwd: s.cwd }, actions: actions({ readArtifact }) }));
    const row = find(groups, "openspec")?.items.find((i) => i.kind === "segments");
    const byId = Object.fromEntries((row?.segments ?? []).map((x) => [x.id, x]));
    expect(byId.specs.state).toBe("skipped");
    expect(byId.proposal.onSelect).toBeTypeOf("function");
    byId.design.onSelect?.();
    expect(readArtifact).toHaveBeenCalledWith("add-auth", "design");
    // 0 tasks → Tasks inert; not complete → Archive inert
    expect(byId.tasks.onSelect).toBeUndefined();
    expect(byId.archive.onSelect).toBeUndefined();
  });

  it("Archive segment is live for a COMPLETE change; Tasks is locked while working", () => {
    const s = makeSession();
    const ch = change({ status: "complete", completedTasks: 3 });
    const openDialog = vi.fn();
    const live = deriveSessionMenu(s, makeCtx(s, { changes: [ch], resolution: { kind: "active", change: ch, cwd: s.cwd }, actions: actions({ openDialog }) }));
    const row = find(live, "openspec")?.items.find((i) => i.kind === "segments");
    row?.segments?.find((x) => x.id === "archive")?.onSelect?.();
    expect(openDialog).toHaveBeenCalledWith("archive");
    const working = deriveSessionMenu(s, makeCtx(s, { working: true, changes: [ch], resolution: { kind: "active", change: ch, cwd: s.cwd } }));
    const wrow = find(working, "openspec")?.items.find((i) => i.kind === "segments");
    expect(wrow?.segments?.find((x) => x.id === "tasks")?.onSelect).toBeUndefined();
    expect(wrow?.segments?.find((x) => x.id === "archive")?.onSelect).toBeUndefined();
  });
});

describe("deriveSessionMenu — activation wiring", () => {
  it("OpenSpec items send the same skills the card did", () => {
    const s = makeSession();
    const a = actions();
    const groups = deriveSessionMenu(s, makeCtx(s, { actions: a }));
    find(groups, "next")?.items[0].onSelect?.();
    expect(a.sendSkill).toHaveBeenCalledWith("openspec-apply-change");
    const planning = change({ status: "no-tasks", artifacts: [{ id: "proposal", status: "done" }, { id: "design", status: "ready" }] });
    const pg = deriveSessionMenu(s, makeCtx(s, { actions: a, changes: [planning], resolution: { kind: "active", change: planning, cwd: s.cwd } }));
    find(pg, "openspec")?.items.find((i) => i.id === "openspec-ff")?.onSelect?.();
    expect(a.sendSkill).toHaveBeenCalledWith("openspec-ff-change");
    find(groups, "openspec")?.items.find((i) => i.id === "openspec-detach")?.onSelect?.();
    expect(a.detach).toHaveBeenCalled();
  });

  it("VIEW offers the two card-section entries", () => {
    const s = makeSession();
    const a = actions();
    const view = find(deriveSessionMenu(s, makeCtx(s, { actions: a })), "view");
    expect(ids(view)).toEqual(["card-sections", "card-defaults"]);
    view?.items[0].onSelect?.();
    view?.items[1].onSelect?.();
    expect(a.openCardSections).toHaveBeenCalled();
    expect(a.openCardDefaults).toHaveBeenCalled();
  });
});

describe("composer ↔ card menu parity (E23)", () => {
  const states: Array<[string, Partial<OpenSpecChange>]> = [
    ["PLANNING", { status: "no-tasks", artifacts: [{ id: "proposal", status: "done" }, { id: "design", status: "ready" }] }],
    ["READY", { status: "no-tasks", completedTasks: 0 }],
    ["IMPLEMENTING", {}],
    ["IMPLEMENTING all done", { isComplete: true }],
    ["COMPLETE", { status: "complete", completedTasks: 3 }],
  ];
  const configs: Array<[string, string[]]> = [
    ["all", ALL],
    ["core", ["new", "continue", "apply"]],
    ["no archive", ALL.filter((w) => w !== "archive")],
  ];
  for (const [stateName, over] of states) {
    for (const [cfgName, wfs] of configs) {
      it(`${stateName} × ${cfgName}: same primary identity and the same workflow item set apart from Detach`, () => {
        const s = makeSession();
        const ch = change(over);
        const wf = (w: string) => wfs.includes(w);
        const menu = deriveSessionMenu(s, makeCtx(s, { changes: [ch], resolution: { kind: "active", change: ch, cwd: s.cwd }, wf }));
        const keys = [find(menu, "next")?.items[0], ...(find(menu, "openspec")?.items ?? [])]
          .filter((i): i is NonNullable<typeof i> => !!i && i.id.startsWith("openspec-") && i.id !== "openspec-detach" && i.id !== "openspec-lifecycle")
          .map((i) => i.id.replace("openspec-", ""));
        // recompute the composer set from the shared deriver with the right ChangeState
        const state = deriveChangeStateForTest(ch);
        const shared = deriveOpenSpecActions({
          attached: true,
          found: true,
          state,
          wf,
          isEnded: false,
          working: false,
          showArchiveAnyway: state === ChangeState.IMPLEMENTING && ch.isComplete === true && ch.artifacts.every((a) => a.status === "done" || a.status === "skipped"),
          includeDetach: false,
          idPrefix: "composer-",
        });
        expect(find(menu, "next")?.items[0]?.id.replace("openspec-", "")).toBe(shared.primary?.key);
        expect([...keys].sort()).toEqual([...(shared.primary ? [shared.primary.key] : []), ...shared.overflow.map((a) => a.key)].sort());
      });
    }
  }
});

void noop;

// Tone (change: colorize-actions-menus, test-plan #E8, #E9).
describe("deriveSessionMenu — tones (E8, E9)", () => {
  const toneOf = (groups: SessionMenuGroup[], id: string) => allItems(groups).find((i) => i.id === id)?.tone;

  it("session host tones", () => {
    const ended = makeSession({ status: "ended", sessionFile: "/x/s.jsonl", gitWorktree: undefined });
    const g1 = deriveSessionMenu(ended, makeCtx(ended));
    expect(toneOf(g1, "resume")).toBe("go");
    expect(toneOf(g1, "fork")).toBe("create");
    expect(toneOf(g1, "rename")).toBeUndefined();
    expect(toneOf(g1, "archive-session")).toBeUndefined();

    const alive = makeSession({ gitPrNumber: 12, gitPrUrl: "https://gh/pr/12", gitPrState: "open" });
    const g2 = deriveSessionMenu(alive, makeCtx(alive, { dirtyCount: 2 }));
    expect(toneOf(g2, "spawn-sibling")).toBe("go");
    expect(toneOf(g2, "exit")).toBe("danger");
    expect(toneOf(g2, "close-worktree")).toBe("danger");
    expect(toneOf(g2, "commit")).toBe("caution");
    expect(toneOf(g2, "view-pr")).toBeUndefined();
    expect(toneOf(g2, "push")).toBeUndefined();
    expect(toneOf(g2, "switch-branch")).toBeUndefined();

    const plain = makeSession({ gitWorktree: undefined, gitBranch: "main", isGitRepo: true });
    const g3 = deriveSessionMenu(plain, makeCtx(plain));
    expect(toneOf(g3, "spawn-worktree")).toBe("caution");

    const wt = makeSession();
    const g4 = deriveSessionMenu(wt, makeCtx(wt));
    expect(toneOf(g4, "open-pr")).toBe("create");
  });

  it("openspec tones: Verify go, New/Propose create, Archive anyway caution; others neutral", () => {
    const s = makeSession({ attachedProposal: undefined });
    const unattached = deriveSessionMenu(s, makeCtx(s, { resolution: null }));
    expect(toneOf(unattached, "openspec-new")).toBe("create");
    expect(toneOf(unattached, "openspec-propose")).toBe("create");
    expect(toneOf(unattached, "openspec-explore")).toBeUndefined();

    const ch = change();
    const attached = makeSession();
    const g = deriveSessionMenu(attached, makeCtx(attached, { changes: [ch], resolution: { kind: "active", change: ch, cwd: attached.cwd } }));
    expect(toneOf(g, "openspec-archiveAnyway")).toBe("caution");
    const done = change({ status: "complete", completedTasks: 3 });
    const gc = deriveSessionMenu(attached, makeCtx(attached, { changes: [done], resolution: { kind: "active", change: done, cwd: attached.cwd } }));
    expect(toneOf(gc, "openspec-verify")).toBe("go");
    expect(toneOf(g, "openspec-detach")).toBeUndefined();
  });

  it("NEXT strips tone; the Merge-emphasis case keeps the OpenSpec home copy's tone (E9)", () => {
    const s = makeSession({ gitPrNumber: 4, gitPrState: "open", gitPrDraft: false, gitPrChecks: "passing", gitPrCheckedAt: Date.now() });
    const ch = change({ status: "complete", completedTasks: 3 });
    const g = deriveSessionMenu(s, makeCtx(s, { mergeIsPrimary: true, changes: [ch], resolution: { kind: "active", change: ch, cwd: s.cwd } }));
    const next = find(g, "next")?.items[0];
    expect(next?.id).toBe("merge");
    expect(next?.tone).toBeUndefined();
    expect(next?.emphasis).toBe(true);

    // streaming session whose NEXT is Verify: disabled, not emphasised, no tone
    const ch2 = change({ status: "complete", completedTasks: 3 });
    const w = makeSession({ status: "streaming" });
    const g2 = deriveSessionMenu(w, makeCtx(w, { working: true, changes: [ch2], resolution: { kind: "active", change: ch2, cwd: w.cwd }, wf: (x) => ALL.filter((a) => a !== "archive").includes(x) }));
    const n2 = find(g2, "next")?.items[0];
    expect(n2?.id).toBe("openspec-verify");
    expect(n2?.disabled).toBe(true);
    expect(n2?.tone).toBeUndefined();
  });
});

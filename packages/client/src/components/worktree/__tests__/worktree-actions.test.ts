/**
 * `deriveWorktreeActions` + the push / open-PR runners shared by the composer
 * strip and the session actions menu. See change: add-session-actions-flyout (D2).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const git = vi.hoisted(() => ({
  pushWorktreeBranch: vi.fn(),
  createWorktreePR: vi.fn(),
}));
vi.mock("../../../lib/git/git-api.js", () => git);

import { deriveWorktreeActions } from "../worktree-actions.js";
import { labelForCode, runWorktreeOpenPr, runWorktreePush } from "../worktree-runners.js";

afterEach(() => {
  vi.restoreAllMocks();
  git.pushWorktreeBranch.mockReset();
  git.createWorktreePR.mockReset();
});

const wt = (over: Partial<DashboardSession> = {}) =>
  ({ id: "s", cwd: "/r/.worktrees/f", source: "tui", status: "idle", startedAt: 1, gitWorktree: { mainPath: "/r", name: "f" }, ...over }) as DashboardSession;

describe("deriveWorktreeActions", () => {
  it("is null for a session that is not a worktree", () => {
    expect(deriveWorktreeActions(wt({ gitWorktree: undefined }), { working: false })).toBeNull();
  });

  it("no PR: Push, Open PR (only with gh), Merge, Close", () => {
    const a = deriveWorktreeActions(wt(), { working: false, ghAvailable: true })!;
    expect([!!a.push, !!a.openPr, !!a.merge, a.close.key, a.hasPr]).toEqual([true, true, true, "close", false]);
    expect(deriveWorktreeActions(wt(), { working: false, ghAvailable: false })!.openPr).toBeUndefined();
    expect(deriveWorktreeActions(wt(), { working: false })!.openPr).toBeUndefined(); // gh probe pending
  });

  it("open PR (or number-only legacy): Push + Merge, no Open PR", () => {
    for (const over of [{ gitPrNumber: 3, gitPrState: "open" as const }, { gitPrNumber: 3 }]) {
      const a = deriveWorktreeActions(wt(over), { working: false, ghAvailable: true })!;
      expect([!!a.push, !!a.openPr, !!a.merge, a.hasPr]).toEqual([true, false, true, true]);
    }
  });

  it("closed PR offers Open PR again; merged PR offers Push only when ahead and never Merge", () => {
    expect(deriveWorktreeActions(wt({ gitPrNumber: 3, gitPrState: "closed" }), { working: false, ghAvailable: true })!.openPr).toBeDefined();
    const merged = wt({ gitPrNumber: 3, gitPrState: "merged" });
    expect(deriveWorktreeActions(merged, { working: false })!.push).toBeUndefined();
    expect(deriveWorktreeActions(merged, { working: false })!.merge).toBeUndefined();
    const ahead = wt({ gitPrNumber: 3, gitPrState: "merged", gitStatus: { dirtyCount: 0, staged: 0, unstaged: 0, untracked: 0, ahead: 2, behind: 0 } as never });
    expect(deriveWorktreeActions(ahead, { working: false })!.push).toBeDefined();
  });

  it("working blocks Push / Open PR / Merge but never Close", () => {
    const a = deriveWorktreeActions(wt(), { working: true, ghAvailable: true })!;
    expect([a.push?.blocked, a.openPr?.blocked, a.merge?.blocked, a.close.blocked]).toEqual([true, true, true, false]);
  });
});

describe("runners", () => {
  it("labelForCode falls back to the raw code", () => {
    expect(labelForCode("no_remote")).toMatch(/origin/);
    expect(labelForCode("weird")).toBe("weird");
  });

  it("runWorktreePush maps success and failure to toasts", async () => {
    git.pushWorktreeBranch.mockResolvedValueOnce({ ok: true });
    expect(await runWorktreePush("/r")).toMatchObject({ level: "success" });
    git.pushWorktreeBranch.mockResolvedValueOnce({ ok: false, code: "auth_failed", stderr: "denied" });
    expect(await runWorktreePush("/r")).toMatchObject({ level: "error", stderr: "denied" });
  });

  it("runWorktreeOpenPr opens an https PR URL in a new tab through a noopener anchor", async () => {
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });
    git.createWorktreePR.mockResolvedValueOnce({ ok: true, data: { url: "https://github.com/o/r/pull/9" } });
    expect(await runWorktreeOpenPr("/r")).toMatchObject({ level: "success" });
    expect(clicks).toHaveLength(1);
    expect(clicks[0].href).toBe("https://github.com/o/r/pull/9");
    expect(clicks[0].target).toBe("_blank");
    expect(clicks[0].rel).toContain("noopener");
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "not a url"])("never navigates to %s", async (url) => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    git.createWorktreePR.mockResolvedValueOnce({ ok: true, data: { url } });
    expect(await runWorktreeOpenPr("/r")).toBeNull();
    expect(click).not.toHaveBeenCalled();
  });

  it("runWorktreeOpenPr maps a failure to an error toast", async () => {
    git.createWorktreePR.mockResolvedValueOnce({ ok: false, code: "gh_not_found", stderr: "" });
    expect(await runWorktreeOpenPr("/r")).toMatchObject({ level: "error" });
  });
});

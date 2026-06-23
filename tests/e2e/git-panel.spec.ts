import { test, expect } from "@playwright/test";
import { byTestId, ensureGitSession } from "./helpers/index.js";

// Scenario 5.2 — VCS (git) panel renders for a session in a git repo.
//
// Note on testid choice: design.md named `composer-git-group`, but that group
// only renders for WORKTREE sessions (`showGit && session.gitWorktree`). A
// plain session pinned in a git repo is not a worktree, so this spec asserts
// the session-card git indicator instead: `git-branch-btn` renders only once
// the bridge reports `session.gitBranch` (i.e. it read git status from the
// repo). That IS the "git status renders" proof for a non-worktree git
// session. See change: add-e2e-spawn-scenarios.
test.describe("git VCS panel", () => {
  test("session in git fixture shows the branch indicator", async ({ page }) => {
    await ensureGitSession(page);

    // Resolves asynchronously: the bridge reports session.gitBranch shortly
    // after the session registers. Until then the card shows `git-init-btn`.
    // The branch button (title "Switch branch") appearing proves git status
    // was read from sample-git. Asserted page-level: it renders on the session
    // card but may not be a descendant of the `session-card-desktop` element.
    await expect(byTestId(page, "gitBranchBtn").first()).toBeVisible({
      timeout: 30_000,
    });
  });
});

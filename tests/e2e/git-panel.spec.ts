import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { byTestId, ensureGitSession, expandFolder, FIXTURE_GIT, folderHeaderBranch, gotoDashboard } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

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

/**
 * test-plan #F5 — an out-of-band `git checkout` in the MAIN checkout still
 * converges the folder header through the changed (eligible-child) fallback.
 *
 * The shipped folder-HEAD watcher/poll path is what converges this; the change
 * narrows only the client's no-folder-HEAD-entry fallback, so this pins that
 * the authoritative path was not collaterally broken.
 * See change: fix-folder-header-worktree-branch-leak.
 */
/** Resolve the harness container by the dashboard port it publishes. */
function harnessContainer(): string {
  const out = execFileSync(
    "docker",
    ["ps", "--filter", `publish=${DASHBOARD_PORT}`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  ).trim();
  const name = out.split("\n").filter(Boolean)[0];
  if (!name) throw new Error(`no running container publishes port ${DASHBOARD_PORT}`);
  return name;
}

function gitInFixture(args: string): string {
  return execFileSync(
    "docker",
    ["exec", harnessContainer(), "sh", "-c", `cd '${FIXTURE_GIT}' && git ${args}`],
    { encoding: "utf8" },
  ).trim();
}

test.describe("folder header converges on an out-of-band checkout", () => {
  const TMP_BRANCH = `e2e-oob-${Date.now().toString(36)}`;
  let original = "";

  test.afterAll(() => {
    if (!original) return;
    try { gitInFixture(`checkout ${original}`); } catch { /* best-effort */ }
    try { gitInFixture(`branch -D ${TMP_BRANCH}`); } catch { /* best-effort */ }
  });

  test("out-of-band checkout still converges the header (test-plan #F5)", async ({ page }) => {
    await ensureGitSession(page);
    await gotoDashboard(page);
    await expandFolder(page, FIXTURE_GIT);

    original = gitInFixture("rev-parse --abbrev-ref HEAD");
    await expect
      .poll(() => folderHeaderBranch(page, FIXTURE_GIT), { timeout: 60_000 })
      .toBe(original);

    // Out-of-band: the dashboard never touches HEAD here.
    gitInFixture(`checkout -b ${TMP_BRANCH}`);

    // The watcher fires sub-second; the poll is the ≤60s fallback.
    await expect
      .poll(() => folderHeaderBranch(page, FIXTURE_GIT), { timeout: 90_000 })
      .toBe(TMP_BRANCH);
  });
});

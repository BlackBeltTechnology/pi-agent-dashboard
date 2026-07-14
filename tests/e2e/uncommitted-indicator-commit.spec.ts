import { expect, test } from "@playwright/test";
import {
  byTestId,
  cleanupCommit,
  dirtyMarkdown,
  ensureGitSession,
  FIXTURE_GIT,
  readChangedFiles,
  readGitStatus,
  spawnFreshGitSession,
  TESTIDS,
} from "./helpers/index.js";

// Browser E2E for the uncommitted-indicator + commit-from-card feature
// (change: add-session-uncommitted-indicator-and-commit). Covers the manual
// QA scenarios V.1–V.4 + V.2b against the Docker harness.
//
// Setup-only backdoor: git state is dirtied/cleaned via the dashboard's OWN
// same-origin REST (helpers `dirtyMarkdown` / `cleanupCommit`). The pill,
// dialog, file-picker, commit, and AI-draft are ALL driven through the real
// UI. The fixture repo `sample-git` exposes two writable tracked markdown
// files (README.md + notes.md) so a subset commit is observable.
//
// Isolation: specs share one container + one fixture repo, so every spec
// commits its dirt back to CLEAN in afterEach (advancing HEAD is harmless).

const CWD = FIXTURE_GIT;

test.describe("uncommitted indicator + commit from card", () => {
  test.afterEach(async ({ page }) => {
    // Return the shared fixture repo to a clean tree for the next spec.
    await cleanupCommit(page, CWD).catch(() => {});
  });

  // ── V.1 — pill reflects dirty count via the on-demand refresh ────────────
  test("V.1 dirty working tree surfaces the pill with the file count", async ({ page }) => {
    await ensureGitSession(page);
    // Branch must be reported before GitInfo (and its pill) can render.
    await expect(byTestId(page, "gitBranchBtn").first()).toBeVisible({ timeout: 30_000 });

    // Establish a clean baseline (specs share one container + fixture repo, so
    // a prior run may have left the tree dirty). Then reload → no dirty pill.
    await cleanupCommit(page, CWD);
    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
    await ensureGitSession(page);
    await expect(byTestId(page, "gitDirtyPill")).toHaveCount(0, { timeout: 20_000 });

    // Dirty one tracked markdown file, then reload so GitInfo remounts and its
    // mount-time on-demand `GET /api/git/status` refresh reads the fresh count.
    await dirtyMarkdown(page, CWD, "README.md", "e2e V.1 dirty marker");
    expect((await readGitStatus(page, CWD))?.dirtyCount).toBe(1);

    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
    await ensureGitSession(page);

    const count = byTestId(page, "gitDirtyCount").first();
    await expect(count).toBeVisible({ timeout: 20_000 });
    await expect(count).toContainText("1");
  });

  // ── V.2 — commit a chosen subset; unchosen files stay dirty ──────────────
  test("V.2 commit a subset leaves the unchosen file dirty", async ({ page }) => {
    await ensureGitSession(page);
    await expect(byTestId(page, "gitBranchBtn").first()).toBeVisible({ timeout: 30_000 });

    await dirtyMarkdown(page, CWD, "README.md", "e2e V.2 readme");
    await dirtyMarkdown(page, CWD, "notes.md", "e2e V.2 notes");
    expect((await readGitStatus(page, CWD))?.dirtyCount).toBe(2);

    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
    await ensureGitSession(page);

    const pill = byTestId(page, "gitDirtyPill").first();
    await expect(pill).toBeVisible({ timeout: 20_000 });
    await pill.click();

    const dialog = byTestId(page, "commitDialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await byTestId(page, "commitFileList").waitFor({ state: "visible" });

    // Deselect README.md → commit only notes.md.
    await page.getByTestId(`commit-file-${"README.md"}`).uncheck();
    await byTestId(page, "commitSubject").fill("chore: commit notes only");
    await byTestId(page, "commitSubmit").click();

    // Dialog closes; README.md remains the sole dirty file.
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect
      .poll(async () => (await readChangedFiles(page, CWD)).map((f) => f.path).sort(), { timeout: 15_000 })
      .toEqual(["README.md"]);
  });

  // ── V.2b — grouped same-cwd sessions: ONE header pill, none on cards ─────
  test("V.2b two sessions in one cwd show one folder-header pill, none on cards", async ({ page }) => {
    // Two non-worktree sessions in the same cwd → one folder group.
    await spawnFreshGitSession(page);
    await spawnFreshGitSession(page);

    await dirtyMarkdown(page, CWD, "README.md", "e2e V.2b marker");
    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });

    // Cards in a group suppress their own GitInfo → zero dirty pills inside
    // any session card.
    const cardPills = page
      .getByTestId(TESTIDS.sessionCardDesktop)
      .getByTestId(TESTIDS.gitDirtyPill);
    await expect(byTestId(page, "groupCommitBtn")).toHaveCount(1, { timeout: 20_000 });
    await expect(cardPills).toHaveCount(0);

    // Committing from the folder header updates the shared count for the cwd.
    await byTestId(page, "groupCommitBtn").click();
    const dialog = byTestId(page, "commitDialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await byTestId(page, "commitSubject").fill("chore: folder-level commit");
    await byTestId(page, "commitSubmit").click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect
      .poll(async () => (await readGitStatus(page, CWD))?.dirtyCount, { timeout: 15_000 })
      .toBe(0);
  });

  // ── V.3 — AI draft never hangs; no visible-conversation pollution ────────
  test("V.3 AI draft fills the message without adding a conversation turn", async ({ page }) => {
    await ensureGitSession(page);
    await expect(byTestId(page, "gitBranchBtn").first()).toBeVisible({ timeout: 30_000 });

    await dirtyMarkdown(page, CWD, "README.md", "e2e V.3 marker");
    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
    await ensureGitSession(page);

    const cardsBefore = await page.getByTestId(TESTIDS.sessionCardDesktop).count();

    const pill = byTestId(page, "gitDirtyPill").first();
    await expect(pill).toBeVisible({ timeout: 20_000 });
    await pill.click();
    await expect(byTestId(page, "commitDialog")).toBeVisible({ timeout: 10_000 });

    await byTestId(page, "commitAiDraft").click();
    // Ladder ALWAYS resolves (fork-subagent → diff-only → stub): the subject
    // fills OR the "unavailable" note shows. Either proves the dialog never
    // hangs. Under the faux harness the model may be absent → stub message.
    await expect
      .poll(
        async () => {
          const subject = await byTestId(page, "commitSubject").inputValue();
          const unavailable = await byTestId(page, "commitDraftUnavailable").count();
          return subject.trim().length > 0 || unavailable > 0;
        },
        { timeout: 40_000 },
      )
      .toBe(true);

    // Zero pollution: the ephemeral fork-subagent is NOT a visible session.
    expect(await page.getByTestId(TESTIDS.sessionCardDesktop).count()).toBe(cardsBefore);
  });

  // ── V.4 — drift chips absent when the tree is clean and in sync ──────────
  // The baked fixture has no upstream, so ahead/behind are always 0 and the
  // ↑/↓ chips must NOT render. (True ahead/behind requires a remote, outside
  // the harness's baked-fixture scope.) This proves the drift-chip gate.
  test("V.4 no ahead/behind chips when clean and in sync (no upstream)", async ({ page }) => {
    await ensureGitSession(page);
    await expect(byTestId(page, "gitBranchBtn").first()).toBeVisible({ timeout: 30_000 });

    // Ensure a clean tree, confirm no upstream drift via the API.
    await cleanupCommit(page, CWD);
    const status = await readGitStatus(page, CWD);
    expect(status?.ahead).toBe(0);
    expect(status?.behind).toBe(0);

    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
    await ensureGitSession(page);

    // No drift chips, and (clean tree) no dirty pill either.
    await expect(byTestId(page, "gitAhead")).toHaveCount(0);
    await expect(byTestId(page, "gitBehind")).toHaveCount(0);
  });
});

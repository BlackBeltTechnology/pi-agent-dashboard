import { expect, test } from "@playwright/test";
import {
  cleanupCommit,
  dirtyMarkdown,
  FIXTURE_GIT,
  sendPrompt,
  spawnFreshGitSession,
} from "./helpers/index.js";

/**
 * E2E for change `detect-tool-created-files` (scenarios U1 + U3).
 *
 * A bash tool call writes a NEW file into the session cwd (a git repo); the
 * server's git-status detector + Bash attributor surface it as an
 * `origin:"tool"` row with `producedBy`, so the Files panel badges it and shows
 * `created by <command>` (U1). Separately, a tracked file dirtied via the
 * dashboard's own REST (NO session tool event) has no ownership evidence, so it
 * lands in `otherChanges` and renders under the muted, collapsed
 * `N other working-tree changes` group with a "this session only" toggle (U3).
 */

const CWD = FIXTURE_GIT;

test.describe("detect tool-created files", () => {
  test.afterEach(async ({ page }) => {
    await cleanupCommit(page, CWD).catch(() => {});
  });

  test("U1 badges a tool row; U3 groups + toggles other working-tree changes", async ({
    page,
  }) => {
    await spawnFreshGitSession(page);

    // A tracked file dirtied out-of-band (no session event) → otherChanges.
    // Its mtime must sit OUTSIDE the later Bash execution window (±1s slack in
    // the ownership gate), so dirty it first, then let a gap elapse before the
    // prompt drives the bash call.
    await dirtyMarkdown(page, CWD, "README.md", "e2e tool-created-files other-change marker");
    await page.waitForTimeout(2500);

    // A bash tool call writes a NEW file into cwd → detected + attributed.
    await sendPrompt(page, "[[faux:tool-bash-artifact]] write a file");

    // Dismiss any spawn-error toasts (the container session's embedded dashboard
    // fails readiness — harness noise) that overlap + intercept the chip.
    for (const btn of await page.getByRole("button", { name: "Dismiss" }).all()) {
      await btn.click().catch(() => {});
    }

    // Open the Files panel (chip → rail).
    const chip = page.getByTestId("changed-files-chip");
    await expect(chip).toBeVisible({ timeout: 20_000 });
    await chip.click();
    const rail = page.getByTestId("changes-rail-section");
    await expect(rail).toBeVisible({ timeout: 10_000 });

    // U1 — the tool-created file row carries an origin badge + "created by".
    await expect(rail.getByText("tool-artifact.md").first()).toBeVisible({ timeout: 10_000 });
    await expect(rail.getByTestId("origin-badge").first()).toBeVisible();
    await expect(rail.getByText(/created by/i).first()).toBeVisible();

    // U3 — the other-changes group renders collapsed by default (its file rows
    // are hidden until expanded) with a "this session only" toggle.
    const group = rail.getByTestId("other-changes-group");
    await expect(group).toBeVisible();
    await expect(group.getByText("README.md")).toHaveCount(0);

    // Toggling "this session only" hides the group entirely.
    await rail.getByTestId("session-only-toggle").locator("input").check();
    await expect(rail.getByTestId("other-changes-group")).toHaveCount(0);
  });
});

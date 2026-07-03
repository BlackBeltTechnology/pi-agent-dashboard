import { expect, type Page, test } from "@playwright/test";
import { gotoDashboard } from "./helpers/index.js";

// KB folder slot — browser E2E against the disposable Docker harness.
// Covers tasks 6.1/6.2 (session-less worktree index through the UI), 3.x (row +
// five-state + settings-reachable-in-every-state gap fix), 4.x/5.x (config read
// + settings page), and 7.3 (mockup-parity browser pass).
//
// Fixture: docker/fixtures/kb-sample → materialized writable at /fixtures/
// kb-sample by test-entrypoint.sh (same mechanism as sample-git). It carries a
// knowledge_base.json (origin=project, sources:["."]) + two .md files, so
// "Index now" produces chunks>0 fast and deterministically with NO attached pi
// session (server-owned reindex). See change: add-kb-folder-slot.
const KB_FIXTURE = "/fixtures/kb-sample";

// Copy-from-parent fixture pair: a parent repo carrying a knowledge_base.json
// (origin=project, sources:["."]) and a nested worktree with NO config. Uses a
// `worktrees/` segment (not `.worktrees/`) so the PathPicker lists it (no hidden
// dir) while `parentRepoOf` still derives the parent. See change: add-kb-folder-slot.
const KB_PARENT = "/fixtures/kb-parent";
const KB_WORKTREE = "/fixtures/kb-parent/worktrees/kb-wt";

/** The folder-kb-section under the nearest folder-card of a cwd's header anchor. */
function kbRowFor(page: Page, cwd: string) {
  return page.locator(
    `xpath=//*[@data-testid="folder-urgency-sort-${cwd}"]/ancestor::div[.//*[@data-testid="folder-kb-section"]][1]//*[@data-testid="folder-kb-section"]`,
  );
}

/**
 * Navigate to the dashboard, dismiss the first-launch modal, and settle into a
 * state that exposes an add-folder affordance. Handles BOTH modes: a fresh/empty
 * container shows the onboarding CTA; once a folder exists the sidebar button
 * shows instead (the seeded sample-git sessions end over a long container life,
 * so either mode can occur).
 */
async function prepareShell(page: Page): Promise<void> {
  await gotoDashboard(page);
  const skip = page.getByRole("button", { name: /^skip$/i });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect(
    page.getByTestId("onboarding-step-2-cta").or(page.getByTestId("dashboard-add-folder-btn")).first(),
  ).toBeVisible({ timeout: 30_000 });
}

/**
 * Robust pin: opens the pin dialog via whichever add-folder affordance the
 * current mode exposes (onboarding CTA or sidebar button). The PathPicker
 * re-lists /home/pi on mount and can overwrite an immediate fill (a race the
 * shared helper hits): settle the initial listing, fill, then ASSERT the value
 * stuck (auto-retry) before Select.
 */
async function pinFixture(page: Page, absPath: string): Promise<void> {
  const onboardingCta = page.getByTestId("onboarding-step-2-cta");
  if (await onboardingCta.isVisible().catch(() => false)) await onboardingCta.click();
  else await page.getByTestId("dashboard-add-folder-btn").first().click();
  const dialog = page.getByTestId("pin-directory-dialog");
  await dialog.waitFor({ state: "visible" });
  const textbox = dialog.getByRole("textbox");
  // Let the initial listing render so it can't clobber the fill below.
  await dialog.getByRole("option").first().waitFor({ state: "visible" });
  await textbox.fill(absPath);
  await expect(textbox).toHaveValue(absPath);
  const leaf = (absPath.split("/").filter(Boolean).pop() ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await dialog.getByRole("option", { name: new RegExp(leaf) }).waitFor({ state: "visible" });
  await dialog.getByRole("button", { name: /^select$/i }).click();
  await dialog.waitFor({ state: "hidden" });
}

test.describe("KB folder slot", () => {
  test("renders, indexes session-less, and opens settings", async ({ page }) => {
    await prepareShell(page);

    // Idempotent: pin the fixture only if it is not already in the sidebar.
    // Anchor scoping uses the unconditional per-folder header testid
    // `folder-urgency-sort-<cwd>` (the folder group div carries no testid, and
    // the sidebar hosts the seeded sample-git folder too — a bare
    // folder-kb-section would be ambiguous). No app testids added for E2E.
    const cwdAnchor = `folder-urgency-sort-${KB_FIXTURE}`;
    if ((await page.getByTestId(cwdAnchor).count()) === 0) await pinFixture(page, KB_FIXTURE);

    // The KB row for THIS folder = the folder-kb-section under the nearest
    // ancestor folder-card of the cwd anchor.
    const kbRow = kbRowFor(page, KB_FIXTURE);
    await expect(kbRow).toBeVisible({ timeout: 20_000 });

    // Settings is reachable in EVERY state (the reachability gap fix).
    await expect(kbRow.getByTestId("folder-kb-open-settings")).toBeVisible();

    // Settle out of the transient "loading" state before branching (the row
    // reports data-state="loading" until the first /stats fetch resolves; a
    // single read could otherwise race it and skip the index click).
    await expect(kbRow).not.toHaveAttribute("data-state", "loading", { timeout: 15_000 });

    // Drive the session-less index if not already populated: Index now → POST
    // /api/kb/reindex runs in the dashboard-server process (no pi session) →
    // chunks>0 → the row flips to populated live.
    if ((await kbRow.getAttribute("data-state")) === "not-indexed") {
      await kbRow.getByTestId("folder-kb-index-now").click();
    }
    await expect(kbRow).toHaveAttribute("data-state", "populated", { timeout: 30_000 });
    await expect(kbRow.getByTestId("folder-kb-count")).toContainText(/chunks/i);

    // The label opens the per-folder KB settings overlay (real click dispatch).
    await kbRow.getByTestId("folder-kb-open-settings").click();
    await expect(page).toHaveURL(/\/folder\/.+\/kb$/);
    await expect(page.getByTestId("kb-settings-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("kb-config-origin")).toContainText(/project/i);
    // The fixture's single source is listed; the dbPath field is editable.
    await expect(page.getByTestId("kb-source-row")).toHaveCount(1);
    await expect(page.getByTestId("kb-dbpath")).toHaveValue(/index\.db$/);
  });

  test("worktree bootstrap: Copy from parent repo seeds config + indexes", async ({ page }) => {
    await prepareShell(page);

    // Pin the parent (must be a KNOWN folder for Copy-from-parent's GET
    // /api/kb/config?cwd=parent to pass the cwd guard) AND the worktree.
    if ((await page.getByTestId(`folder-urgency-sort-${KB_PARENT}`).count()) === 0) await pinFixture(page, KB_PARENT);
    if ((await page.getByTestId(`folder-urgency-sort-${KB_WORKTREE}`).count()) === 0) await pinFixture(page, KB_WORKTREE);

    // The worktree ships no config → not-indexed (empty resolved sources).
    const wtRow = kbRowFor(page, KB_WORKTREE);
    await expect(wtRow).toBeVisible({ timeout: 20_000 });
    await expect(wtRow).not.toHaveAttribute("data-state", "loading", { timeout: 15_000 });
    await expect(wtRow).toHaveAttribute("data-state", "not-indexed");

    // Settings is reachable even not-indexed (gap fix) → opens bootstrap panel.
    await wtRow.getByTestId("folder-kb-open-settings").click();
    await expect(page.getByTestId("kb-settings-page")).toBeVisible({ timeout: 15_000 });
    // No project file yet: origin is a fallback + bootstrap affordances present.
    await expect(page.getByTestId("kb-config-origin")).not.toContainText(/project/i);
    await expect(page.getByTestId("kb-copy-parent")).toBeVisible();
    await expect(page.getByTestId("kb-create-config")).toBeVisible();

    // Copy from parent repo → fetch parent config, seed sources[], PUT a project
    // config for the worktree, kick a reindex.
    await page.getByTestId("kb-copy-parent").click();
    // The project config is now written (origin flips) with the copied source.
    await expect(page.getByTestId("kb-config-origin")).toContainText(/project/i, { timeout: 15_000 });
    await expect(page.getByTestId("kb-source-row")).toHaveCount(1);
    // The panel's live count reflects the reindex (the indexed label carries
    // "files"; the not-indexed label reads "0 chunks · not indexed"). This is the
    // immediate feedback the user sees on the settings page.
    await expect(page.getByTestId("kb-config-count")).toContainText(/files/i, { timeout: 30_000 });

    // Back to the sidebar, then reload so the row re-fetches: the v1 sidebar row
    // refetches on mount/expand/poll, not on an index driven from the settings
    // page (design §4 defers a kb_stats_update broadcast to v1.1). The reload
    // proves the worktree KB is now persisted + populated.
    await page.getByTestId("kb-settings-back").click();
    await page.reload();
    const skip2 = page.getByRole("button", { name: /^skip$/i });
    if (await skip2.isVisible().catch(() => false)) await skip2.click();
    const wtRowReloaded = kbRowFor(page, KB_WORKTREE);
    await expect(wtRowReloaded).toHaveAttribute("data-state", "populated", { timeout: 30_000 });
    await expect(wtRowReloaded.getByTestId("folder-kb-count")).toContainText(/chunks/i);
  });
});

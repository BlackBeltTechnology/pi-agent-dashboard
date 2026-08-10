import { expect, type Locator, type Page, test } from "@playwright/test";
import { ensureGitSession, FIXTURE_GIT } from "./helpers/index.js";

// change: openspec-artifact-dialog-desktop — on non-mobile, clicking an
// OpenSpec artifact badge opens a local-state Dialog OVER the current view
// (URL unchanged) instead of navigating to the full-page preview route. Mobile
// keeps the full-page route. These specs drive the real prompt→bridge→/ws→
// openspec-poll round-trip against the docker harness fixture
// `/fixtures/sample-git`, which ships an `openspec/` project (change
// `e2e-artifact-demo`, all 4 artifacts) so the P/D/S/T badges render.
//
// The board (`ProposalCard` → `OpenSpecStepper`) renders clickable
// `stepper-node-*` badges for any cwd change WITHOUT attachment, so it is the
// attach-free primary surface. E7 additionally attaches the change to cover
// the composer-chip + header-button wiring sites.

const BOARD_URL = `/folder/${Buffer.from(FIXTURE_GIT).toString("base64url")}/openspec`;
const ARCHIVE_URL = `/folder/${Buffer.from(FIXTURE_GIT).toString("base64url")}/openspec/archive`;

/** Ensure the fixture session exists, then land on the desktop OpenSpec board
 *  with the demo change's badges hydrated. */
async function openBoard(page: Page): Promise<Locator> {
  await ensureGitSession(page);
  await page.goto(BOARD_URL);
  await page.getByTestId("openspec-board").waitFor({ state: "visible", timeout: 20_000 });
  const badge = page.getByTestId("stepper-node-proposal").first();
  // The openspec poll populates openspecMap after spawn; the ProposalCard +
  // stepper mount once it arrives.
  await badge.waitFor({ state: "visible", timeout: 45_000 });
  return badge;
}

const dialog = (page: Page) => page.getByTestId("openspec-artifact-dialog");

test.describe("non-mobile OpenSpec artifact dialog", () => {
  test("F1: badge opens dialog over the board, URL unchanged, P/D/S/T tabs with P active", async ({ page }) => {
    const badge = await openBoard(page);
    const urlBefore = page.url();

    await badge.click();
    await expect(dialog(page)).toBeVisible();
    // Underlying board still mounted behind the modal.
    await expect(page.getByTestId("openspec-board")).toBeVisible();
    // No navigation happened.
    expect(page.url()).toBe(urlBefore);

    // Tab bar shows all four artifacts.
    for (const id of ["proposal", "design", "specs", "tasks"]) {
      await expect(dialog(page).getByTestId(`preview-tab-${id}`)).toBeVisible();
    }
    // Proposal active → proposal content shown.
    await expect(dialog(page).getByText(/Proposal — e2e artifact demo/)).toBeVisible();
  });

  test("F2: switching tabs is local state — content changes, no history push, URL unchanged", async ({ page }) => {
    const badge = await openBoard(page);
    await badge.click();
    await expect(dialog(page)).toBeVisible();

    const urlBefore = page.url();
    const historyBefore = await page.evaluate(() => window.history.length);

    await dialog(page).getByTestId("preview-tab-design").click();
    await expect(dialog(page).getByText(/Design — e2e artifact demo/)).toBeVisible();

    expect(page.url()).toBe(urlBefore);
    expect(await page.evaluate(() => window.history.length)).toBe(historyBefore);
  });

  test("F3: flex wrapper renders full height — header, tabs, and non-collapsed content", async ({ page }) => {
    const badge = await openBoard(page);
    await badge.click();
    await expect(dialog(page)).toBeVisible();

    await expect(dialog(page).getByTestId("preview-back")).toBeVisible();
    await expect(dialog(page).getByTestId("preview-tabs")).toBeVisible();
    const content = dialog(page).getByTestId("markdown-preview");
    const box = await content.boundingBox();
    expect(box, "content area must have a layout box").not.toBeNull();
    // The regression this guards: `flex-1` with no flex parent collapses the
    // content area to intrinsic height.
    expect(box!.height).toBeGreaterThan(100);
  });

  test("F4: Esc, backdrop, and reader-back each close the dialog and reveal the board", async ({ page }) => {
    const badge = await openBoard(page);

    // Esc
    await badge.click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByTestId("openspec-board")).toBeVisible();

    // Backdrop
    await badge.click();
    await expect(dialog(page)).toBeVisible();
    await page.getByTestId("openspec-artifact-dialog-overlay").click({ position: { x: 5, y: 5 } });
    await expect(dialog(page)).toHaveCount(0);

    // Reader back control
    await badge.click();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByTestId("preview-back").click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByTestId("openspec-board")).toBeVisible();
  });

  test("F5: focus returns to the triggering badge on close", async ({ page }) => {
    const badge = await openBoard(page);
    await badge.click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(badge).toBeFocused();
  });

  test("F6: resizing into the mobile breakpoint auto-closes the dialog", async ({ page }) => {
    const badge = await openBoard(page);
    await badge.click();
    await expect(dialog(page)).toBeVisible();

    await page.setViewportSize({ width: 700, height: 800 });
    await expect(dialog(page)).toHaveCount(0);
  });

  test("F7: the dialog is ephemeral — a reload does not restore it", async ({ page }) => {
    const badge = await openBoard(page);
    await badge.click();
    await expect(dialog(page)).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("openspec-artifact-dialog")).toHaveCount(0);
  });

  test("E7: badge opens the dialog (never navigates) across board, composer, and header sites", async ({ page }) => {
    // Site: board stepper (attach-free).
    const badge = await openBoard(page);
    const boardUrl = page.url();
    await badge.click();
    await expect(dialog(page)).toBeVisible();
    expect(page.url()).toBe(boardUrl);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);

    // Attach the change so the composer-chip + header-button sites render.
    const card = await ensureGitSession(page);
    await card.click();
    await page.getByTestId("attach-combo").first().click();
    await page.getByText("e2e-artifact-demo", { exact: false }).first().click();

    // Site: composer artifact chip.
    const composerP = page.getByTestId("composer-artifact-p");
    await composerP.waitFor({ state: "visible", timeout: 20_000 });
    const urlBeforeComposer = page.url();
    await composerP.click();
    await expect(dialog(page)).toBeVisible();
    expect(page.url()).toBe(urlBeforeComposer);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);

    // Site: header artifact-letters button.
    const headerBtn = page.getByTestId("artifact-letters-btn").first();
    await headerBtn.waitFor({ state: "visible", timeout: 20_000 });
    const urlBeforeHeader = page.url();
    await headerBtn.click();
    await expect(dialog(page)).toBeVisible();
    expect(page.url()).toBe(urlBeforeHeader);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
  });

  test("E8: archived-change badge opens the archive reader, not the artifact dialog", async ({ page }) => {
    await ensureGitSession(page);
    await page.goto(ARCHIVE_URL);
    await page.getByTestId("archive-browser").waitFor({ state: "visible", timeout: 20_000 });

    const letter = page.getByTestId("artifact-letter").first();
    await letter.waitFor({ state: "visible", timeout: 20_000 });
    await letter.click();

    // The archive reader (ArchiveArtifactReader → MarkdownPreviewView) renders
    // in place; the non-mobile artifact dialog must NOT appear.
    await expect(page.getByTestId("markdown-preview")).toBeVisible();
    await expect(page.getByTestId("openspec-artifact-dialog")).toHaveCount(0);
  });

  test("E9: on mobile the badge navigates to the full-page preview route (no dialog)", async ({ page }) => {
    // Set up the session on the desktop shell, THEN cross into the mobile
    // breakpoint so the onboarding/spawn affordances stay deterministic.
    await ensureGitSession(page);
    await page.setViewportSize({ width: 700, height: 800 });
    await page.goto(BOARD_URL);
    await page.getByTestId("openspec-board").waitFor({ state: "visible", timeout: 20_000 });
    const badge = page.getByTestId("stepper-node-proposal").first();
    await badge.waitFor({ state: "visible", timeout: 45_000 });

    await badge.click();

    await expect(page.getByTestId("openspec-artifact-dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/openspec\/e2e-artifact-demo\/proposal/);
  });
});

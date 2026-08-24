import { expect, type Locator, type Page, test } from "./fixtures.js";
import { ensureGitSession, expandFolder, FIXTURE_GIT, folderCard, gotoDashboard } from "./helpers/index.js";

/**
 * Browser E2E — the folder actions menu after the slot-pill controls moved in.
 *
 * These need REAL rendering: whether activating the trigger also navigates or
 * collapses the folder, whether two sidebar folders can co-open a menu, the
 * mobile sheet's presentation and focus return, and whether the rendered card's
 * pill grid genuinely holds zero action buttons. jsdom expresses none of that.
 * The registry mechanics (registration, ordering, collision, deregistration)
 * are unit-tested in `packages/dashboard-plugin-runtime/src/__tests__/
 * folder-menu-contributions.test.tsx`.
 *
 * Covers test-plan #E1, #E2, #F7, #F8, #F9.
 * See change: move-slot-actions-to-menu.
 */

const CWD = FIXTURE_GIT;

function trigger(page: Page, cwd = CWD): Locator {
  return page.getByTestId(`folder-actions-menu-${cwd}`).first();
}

function panel(page: Page, cwd = CWD): Locator {
  return page.getByTestId(`folder-actions-menu-panel-${cwd}`).first();
}

async function openMenu(page: Page, cwd = CWD): Promise<void> {
  if (await panel(page, cwd).isVisible().catch(() => false)) return;
  await trigger(page, cwd).click();
  await expect(panel(page, cwd)).toBeVisible({ timeout: 10_000 });
}

async function closeMenu(page: Page, cwd = CWD): Promise<void> {
  if (!(await panel(page, cwd).isVisible().catch(() => false))) return;
  await page.keyboard.press("Escape");
  await expect(panel(page, cwd)).toHaveCount(0, { timeout: 10_000 });
}

test.describe("folder actions menu", () => {
  test.beforeEach(async ({ page }) => {
    await ensureGitSession(page);
    await expandFolder(page, CWD);
  });

  // F7 — the trigger sits inside a header row that navigates to the directory
  // home and toggles collapse; both must stay suppressed.
  test("F7: the trigger opens the menu without navigating or collapsing", async ({ page }) => {
    const before = page.url();
    await openMenu(page);
    expect(page.url()).toBe(before);
    await expect(page.getByTestId(`folder-body-${CWD}`)).toHaveCount(1);
    await closeMenu(page);
  });

  // F8 — open state is keyed per folder SCOPE, so one folder's menu never
  // opens another's.
  test("F8: opening one folder's menu leaves every other folder's closed", async ({ page }) => {
    await openMenu(page);
    const openPanels = await page.locator("[data-testid^='folder-actions-menu-panel-']").count();
    expect(openPanels).toBe(1);
    await closeMenu(page);
  });

  // E1/E2 — the rendered card, not the repo: the pill grid holds no action
  // button, and no pill carries a moved glyph.
  test("E1/E2: the rendered pill grid holds zero action controls", async ({ page }) => {
    const card = folderCard(page, CWD);
    for (const id of [
      "folder-automation-refresh",
      "folder-automation-new-btn",
      "folder-goals-refresh",
      "folder-goal-new-btn",
      "folder-kb-reindex",
      "folder-kb-index-now",
      "folder-kb-retry",
      "folder-openspec-refresh",
      "folder-archive-btn",
      "folder-specs-btn",
    ]) {
      await expect(card.getByTestId(id)).toHaveCount(0);
    }

    // Each rendered slot section exposes exactly one interactive node: its own
    // pill root. Counted across the card, which is where the violation was
    // invisible before.
    const sections = ["folder-automation-section", "folder-goals-section", "folder-kb-section", "folder-openspec-section"];
    let present = 0;
    for (const section of sections) {
      const node = card.getByTestId(section).first();
      if ((await node.count()) === 0) continue;
      present++;
      const interactive = await node.evaluate(
        (el) =>
          el.querySelectorAll("button, a, input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])")
            .length,
      );
      expect(interactive, `${section} exposes one control (its pill root)`).toBe(1);
    }
    // Guard against a vacuous pass: with zero sections rendered the loop above
    // asserts nothing, and the id sweep would also trivially hold.
    expect(present, "at least one slot section rendered on the card").toBeGreaterThan(0);
  });

  test("the moved actions are reachable from the menu instead", async ({ page }) => {
    await openMenu(page);
    // The one plain refresh replacing the three per-slot ones is always present.
    await expect(page.getByTestId("folder-menu-item-refresh-folder")).toBeVisible();
    // Directory Settings keeps the Pi Resources surface's single home.
    await expect(page.getByTestId("folder-menu-item-directory-settings")).toBeVisible();
    await closeMenu(page);
  });
});

// F9 — mobile sheet presentation + focus return. Own describe so the viewport
// override does not leak into the desktop cases above.
test.describe("folder actions menu — mobile sheet (F9)", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("presents as a full-width sheet and returns focus to the trigger", async ({ page }) => {
    await gotoDashboard(page);
    const trig = trigger(page);
    await trig.waitFor({ state: "visible", timeout: 30_000 });
    await trig.click();

    const sheet = panel(page);
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await expect(sheet).toHaveAttribute("data-menu-form", "sheet");

    const [sheetBox, viewportWidth] = await Promise.all([
      sheet.boundingBox(),
      page.evaluate(() => window.innerWidth),
    ]);
    expect(sheetBox).not.toBeNull();
    expect(Math.round(sheetBox!.width)).toBe(viewportWidth);

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0, { timeout: 10_000 });
    await expect(trig).toBeFocused();
  });
});

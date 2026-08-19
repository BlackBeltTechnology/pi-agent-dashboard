import { expect, type Locator, type Page, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT } from "./helpers/index.js";

/**
 * Browser E2E — overlay-layering (change: add-overlay-layering-system).
 *
 * These need REAL compositing/geometry that jsdom cannot express:
 *   F3 — the folder-actions menu, portaled to the layer root, paints ABOVE the
 *        `relative isolate` session cards (the original underlap). Asserted via
 *        `document.elementFromPoint` at a point inside BOTH the menu and a card:
 *        the topmost node must belong to the menu.
 *   F4 — the portaled `fixed` panel tracks its trigger when the sidebar list
 *        scrolls (usePopoverFlip re-measures on capture-phase scroll). Asserted
 *        by the constant gap `panel.top − trigger.bottom ≈ 4px` after a scroll.
 *
 * The jsdom side (portaled-out-of-subtree, z-popover token, both form factors)
 * is covered in FolderActionsMenu.test.tsx (#F1/#F2) and z-layers.test.ts.
 */

const CWD = FIXTURE_GIT;

/** Open the folder-actions menu for the fixture folder; return its panel. */
async function openFolderMenu(page: Page): Promise<Locator> {
  const trigger = page.getByTestId(`folder-actions-menu-${CWD}`);
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();
  const panel = page.getByTestId(`folder-actions-menu-panel-${CWD}`);
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("overlay layering", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("F3 folder-actions menu paints above the isolate session cards (no underlap)", async ({
    page,
  }) => {
    await ensureGitSession(page); // pins FIXTURE_GIT + spawns a card under the folder header
    const card = page.getByTestId("sessionCardDesktop").first();
    await expect(card).toBeVisible({ timeout: 30_000 });

    const panel = await openFolderMenu(page);

    const pBox = await panel.boundingBox();
    const cBox = await card.boundingBox();
    expect(pBox, "panel has a box").not.toBeNull();
    expect(cBox, "card has a box").not.toBeNull();

    // Intersection of panel and card rects — the region where underlap showed.
    const x1 = Math.max(pBox!.x, cBox!.x);
    const y1 = Math.max(pBox!.y, cBox!.y);
    const x2 = Math.min(pBox!.x + pBox!.width, cBox!.x + cBox!.width);
    const y2 = Math.min(pBox!.y + pBox!.height, cBox!.y + cBox!.height);
    expect(x2, "panel and a card overlap horizontally").toBeGreaterThan(x1);
    expect(y2, "panel and a card overlap vertically").toBeGreaterThan(y1);

    const px = (x1 + x2) / 2;
    const py = (y1 + y2) / 2;
    // The topmost element at the overlap point must belong to the menu panel —
    // i.e. the menu paints ABOVE the card, not behind it.
    const topmostInPanel = await page.evaluate(
      ({ x, y, testid }) => {
        const el = document.elementFromPoint(x, y);
        const panelEl = document.querySelector(`[data-testid="${testid}"]`);
        return !!(el && panelEl && (panelEl === el || panelEl.contains(el)));
      },
      { x: px, y: py, testid: `folder-actions-menu-panel-${CWD}` },
    );
    expect(topmostInPanel, "menu is topmost at the overlap point (no underlap)").toBe(true);
  });

  test("F4 portaled panel stays anchored to its trigger when the sidebar scrolls", async ({
    page,
  }) => {
    await ensureGitSession(page);
    const trigger = page.getByTestId(`folder-actions-menu-${CWD}`);
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    const panel = await openFolderMenu(page);

    const gap = async () => {
      const t = await trigger.boundingBox();
      const p = await panel.boundingBox();
      return p!.y - (t!.y + t!.height);
    };
    const before = await gap();
    // Anchor invariant: panel sits ~4px (GAP) below the trigger bottom.
    expect(Math.abs(before - 4), "panel anchored below trigger").toBeLessThanOrEqual(3);

    // Scroll the sidebar list (best-effort; the invariant must hold regardless).
    await page.getByTestId("session-list-scroll").evaluate((el) => {
      el.scrollTop += 120;
    });
    await page.waitForTimeout(120); // let the capture-phase scroll re-measure land

    const after = await gap();
    expect(Math.abs(after - 4), "panel still anchored after scroll (tracks trigger)").toBeLessThanOrEqual(3);
  });
});

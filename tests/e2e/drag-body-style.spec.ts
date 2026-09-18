import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * Browser E2E for test-plan row F23 — capability `drag-body-style`
 * (change: fix-long-session-ux-degradation §1, design D1).
 *
 * WHY THIS LEVEL
 * --------------
 * The unit layer (`useBodyDragStyle.test.tsx`, `body-drag-delegation.test.tsx`)
 * proves the hook and the per-component delegation. This spec proves the real
 * end-to-end trigger the defect named: a resize drag is in progress, the
 * viewport crosses the mobile breakpoint, `App` swaps to the mobile shell and
 * the desktop sidebar **unmounts** with the pointer still down. Before the fix
 * that left `document.body` stuck on `user-select: none` + a resize cursor,
 * killing text selection/copy until a refresh. jsdom cannot reproduce the
 * breakpoint-driven unmount or real selectability, so only this layer can.
 */

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 375, height: 667 };

/** Body drag overrides as the page actually reports them. */
function readBodyStyles(page: Page) {
  return page.evaluate(() => ({
    cursor: document.body.style.cursor,
    userSelect: document.body.style.userSelect,
    computedCursor: getComputedStyle(document.body).cursor,
    computedUserSelect: getComputedStyle(document.body).userSelect,
  }));
}

/** The sidebar may be persisted-collapsed from another spec; expand it. */
async function ensureSidebarExpanded(page: Page): Promise<void> {
  const expand = page.getByTestId("sidebar-expand");
  if (await expand.isVisible().catch(() => false)) {
    await expand.click();
  }
}

test.describe("drag body-style — unmount mid-drag", () => {
  test("F23: a breakpoint flip mid-drag leaves the page selectable with no resize cursor", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await gotoDashboard(page);
    await ensureSidebarExpanded(page);

    const handle = page.getByTestId("drag-handle");
    await expect(handle).toBeVisible({ timeout: 15_000 });
    const box = await handle.boundingBox();
    expect(box, "sidebar drag handle must be laid out").not.toBeNull();
    // Grab the seam ABOVE the collapsed-knob button, which sits centred on the
    // handle and stops mousedown propagation — hitting dead-centre would click
    // the knob instead of starting a drag.
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 12);
    await page.mouse.down();

    // Drag started → the overrides are applied.
    await expect.poll(async () => (await readBodyStyles(page)).cursor).toBe("col-resize");
    expect((await readBodyStyles(page)).userSelect).toBe("none");

    // Cross the breakpoint: App swaps to the mobile shell and the desktop
    // sidebar (with its drag handle) unmounts with the pointer still down.
    await page.setViewportSize(MOBILE);
    await expect(page.getByTestId("drag-handle")).toHaveCount(0, { timeout: 15_000 });

    // Unmount cleanup cleared the overrides.
    await expect.poll(async () => (await readBodyStyles(page)).cursor).toBe("");
    const after = await readBodyStyles(page);
    expect(after.userSelect).toBe("");
    expect(after.computedCursor).not.toBe("col-resize");
    expect(after.computedUserSelect).not.toBe("none");

    // Release the still-held pointer, then prove page text is selectable.
    await page.mouse.up();
    const selectedChars = await page.evaluate(() => {
      const target = document.querySelector('[data-testid="header-app-bar"]');
      if (!target?.textContent) return 0;
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return selection?.toString().length ?? 0;
    });
    expect(selectedChars).toBeGreaterThan(0);
  });
});

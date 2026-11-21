import crypto from "node:crypto";
import { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import type { SpawnResultBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { inContainer, pinViaBus, unpinViaBus } from "./helpers/folder-collapse.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

/**
 * Browser E2E — directory-listing menus stay reachable on a short (13") display
 * (#1153, reproduce-first; see design D5). The reporter did not name the menu,
 * and no surface reproduces from code (every popover is viewport-bounded via
 * `usePopoverFlip` + `overflow-y-auto`; `Dialog` caps at `max-h-[80vh]`), so
 * these specs are the REGRESSION GUARD: 14 pinned folders at 1280×720 / 600.
 * If one fails, fix that surface with `usePopoverFlip`'s `maxHeight` +
 * `overflow-y-auto` — never a second positioning mechanism.
 *
 * Also covers the confirm-dialog focus quirk (#F4): the menu item that opened
 * the dialog unmounts on select, so focus must land on the menu trigger.
 *
 * Covers test-plan #F1, #F2, #F3, #F4, #X6. See change: sidebar-folder-ux.
 */

const PREFIX = "/root/e2e-menu-scroll";
const DIRS = Array.from({ length: 14 }, (_, i) => `${PREFIX}-${String(i).padStart(2, "0")}`);
const LAST = DIRS[DIRS.length - 1];

const trigger = (page: Page, cwd: string): Locator => page.getByTestId(`folder-actions-menu-${cwd}`).first();
const panel = (page: Page, cwd: string): Locator => page.getByTestId(`folder-actions-menu-panel-${cwd}`).first();

async function openMenu(page: Page, cwd: string): Promise<void> {
  const t = trigger(page, cwd);
  await t.scrollIntoViewIfNeeded();
  await t.click();
  await expect(panel(page, cwd)).toBeVisible({ timeout: 10_000 });
}

/** The panel's rendered bottom edge must not run past the viewport. */
async function expectWithinViewport(page: Page, el: Locator): Promise<void> {
  const box = await el.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(box, "panel has a box").toBeTruthy();
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vh + 1);
}

test.describe("directory menus on short viewports (#1153)", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    for (const d of DIRS) inContainer(`mkdir -p ${d}`);
    for (const d of DIRS) await pinViaBus(d);
  });
  test.afterAll(async () => {
    for (const d of DIRS) await unpinViaBus(d);
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoDashboard(page);
    await expect(trigger(page, LAST)).toBeVisible({ timeout: 30_000 });
  });

  for (const height of [720, 600]) {
    test(`F1/X6: folder actions menu stays within a 1280×${height} viewport; last item reachable by wheel and keyboard`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height });
      await openMenu(page, LAST);
      const p = panel(page, LAST);
      await expectWithinViewport(page, p);
      const items = p.locator("[data-testid^='folder-menu-item-']");
      const last = items.last();
      await p.hover();
      await page.mouse.wheel(0, 2_000);
      await expect(last).toBeInViewport();
      await page.keyboard.press("Escape");
      await expect(p).toHaveCount(0);

      await openMenu(page, LAST);
      await items.last().focus();
      await expect(items.last()).toBeInViewport();
      await page.keyboard.press("Escape");
    });
  }

  test("F1: below 600px the sheet form is used and stays reachable", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 599 });
    await openMenu(page, LAST);
    const p = panel(page, LAST);
    await expectWithinViewport(page, p);
    const last = p.locator("[data-testid^='folder-menu-item-']").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
  });

  test("F2: the add-to-workspace popover stays within the viewport at 1280×720", async ({ page }) => {
    await openMenu(page, LAST);
    await page.getByTestId("folder-menu-item-add-to-workspace").click();
    const menu = page.getByTestId("add-to-workspace-menu");
    await expect(menu).toBeVisible({ timeout: 10_000 });
    await expectWithinViewport(page, menu);
    await expect(page.getByTestId("add-to-workspace-new")).toBeInViewport();
    await page.keyboard.press("Escape");
  });

  test("F3: a folder near the bottom edge flips/bounds its menu — one positioning mechanism, no clipping", async ({ page }) => {
    await openMenu(page, LAST);
    const p = panel(page, LAST);
    await expectWithinViewport(page, p);
    // `usePopoverFlip` owns placement: no second inline transform override.
    const style = (await p.getAttribute("style")) ?? "";
    expect(style).not.toMatch(/transform/i);
    await page.keyboard.press("Escape");
  });
});

// F4 — needs a live session so "Remove from sidebar" opens its confirm dialog.
test.describe("confirm dialog focus (#F4)", () => {
  const CWD = `${PREFIX}-focus`;

  async function withBus<T>(fn: (c: BusClient) => Promise<T>): Promise<T> {
    const c = new BusClient({ host: "localhost", port: DASHBOARD_PORT });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      c.close();
    }
  }

  test.afterEach(async () => {
    await unpinViaBus(CWD);
    await withBus(async (c) => {
      for (const s of c.read.sessions().filter((x) => x.cwd === CWD && x.status !== "ended")) {
        c.send({ type: "shutdown", sessionId: s.id });
      }
      await new Promise((r) => setTimeout(r, 300));
    });
  });

  test("F4: after the opener unmounts, focus lands on the menu trigger, never <body>", async ({ page }) => {
    test.setTimeout(180_000);
    inContainer(`mkdir -p ${CWD}`);
    await pinViaBus(CWD);
    await withBus(async (c) => {
      const result = c.await<SpawnResultBrowserMessage>({ type: "spawn_result" }, { timeout: 45_000 });
      c.send({ type: "spawn_session", cwd: CWD, requestId: crypto.randomUUID() });
      const res = await result;
      expect(res.success, res.message).toBe(true);
    });
    await gotoDashboard(page);
    await openMenu(page, CWD);
    await page.getByTestId("folder-menu-item-remove-from-sidebar").click();
    await expect(page.getByTestId("remove-from-sidebar-confirm")).toBeVisible();
    await page.getByTestId("remove-from-sidebar-confirm-cancel").click();
    await expect(page.getByTestId("remove-from-sidebar-confirm")).toHaveCount(0);
    await expect(trigger(page, CWD)).toBeFocused();
    await expect(page.locator("body")).not.toBeFocused();
  });
});

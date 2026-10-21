import { expect, type Locator, type Page, test } from "./fixtures.js";
import { contrastFailures, measureText, nonTextFailures, setThemeMode } from "./helpers/computed-contrast.js";
import { ensureGitSession, pinDirectory } from "./helpers/index.js";

// Level-3 E2E for the folder-card hook banner's inherited colour
// (change: fix-folder-card-pill-contrast; test-plan #F1, #F2, #F7).
//
// Fixture: `/fixtures/sample-hook-ok`, UNTRUSTED → the `retrust` banner rung.
// These specs only OBSERVE the banner — they never trust or run the hook. Trust
// is process-global and the gate flips once, so the specs that run the hook
// (#F3 inside S14, #F4) live in `worktree-init-feedback.spec.ts`, which sorts
// after this file (single worker, alphabetical) and still finds the hook
// untrusted. Palette switching uses `setThemeMode`, the same localStorage keys
// as `severity-contrast.spec.ts`.

const CWD = "/fixtures/sample-hook-ok";
const REGION_ID = `folder-banner-retrust-${CWD}`;
const MESSAGE = "Init hook needs your trust before it can run";

function group(page: Page): Locator {
  return page.locator('[data-testid="sortable-pinned-group"]').filter({ hasText: "sample-hook-ok" });
}

/** Pin the fixture and return the retrust banner region (visible). */
async function surfaceRetrust(page: Page): Promise<Locator> {
  await ensureGitSession(page);
  await pinDirectory(page, CWD);
  const toggle = group(page).getByTestId("folder-toggle-btn").first();
  if ((await toggle.getAttribute("title")) === "Expand folder") await toggle.click();
  const region = group(page).getByTestId(REGION_ID);
  await expect(region).toBeVisible({ timeout: 20_000 });
  return region;
}

const colorOf = (el: Locator): Promise<string> => el.evaluate((e) => getComputedStyle(e).color);

test.describe("folder banner — retrust rung contrast", () => {
  test("F1: base light — text ≥ 4.5:1, glyph ≥ 3:1, message visible", async ({ page }) => {
    await surfaceRetrust(page);
    await setThemeMode(page, "light");
    const fresh = group(page).getByTestId(REGION_ID);
    await expect(fresh).toBeVisible({ timeout: 20_000 });
    await expect(fresh).toContainText(MESSAGE);
    expect(contrastFailures(await measureText(fresh), 4.5)).toEqual([]);
    expect(await nonTextFailures(fresh, 3)).toEqual([]);
  });

  test("F2: the action inherits the region colour in base dark/light and nord dark/light", async ({ page }) => {
    await surfaceRetrust(page);
    const cells: Array<[string, "dark" | "light"]> = [
      ["base", "dark"],
      ["base", "light"],
      ["nord", "dark"],
      ["nord", "light"],
    ];
    for (const [theme, mode] of cells) {
      await setThemeMode(page, mode, theme);
      const region = group(page).getByTestId(REGION_ID);
      await expect(region).toBeVisible({ timeout: 20_000 });
      const btn = region.getByTestId("worktree-init-btn");
      expect(await colorOf(btn), `${theme}/${mode}: action colour vs region`).toBe(await colorOf(region));
    }
  });

  test("F7: action meets the target floor (44 px at 375, 32 px at 1280) and shows a focus ring", async ({ page }) => {
    await surfaceRetrust(page);
    const cells: Array<{ w: number; h: number; min: number }> = [
      { w: 375, h: 812, min: 44 },
      { w: 1280, h: 800, min: 32 },
    ];
    for (const { w, h, min } of cells) {
      await page.setViewportSize({ width: w, height: h });
      const btn = group(page).getByTestId(REGION_ID).getByTestId("worktree-init-btn");
      await expect(btn).toBeVisible({ timeout: 20_000 });
      const box = await btn.boundingBox();
      expect(box, `${w}px: button box`).not.toBeNull();
      expect(box!.height + 0.5, `${w}px: height ${box!.height}`).toBeGreaterThanOrEqual(min);

      // Keyboard-modality Tab walk until the action holds focus.
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      let focused = false;
      for (let i = 0; i < 80 && !focused; i++) {
        await page.keyboard.press("Tab");
        focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "worktree-init-btn");
      }
      expect(focused, `${w}px: Tab reaches worktree-init-btn`).toBe(true);
      const ring = await btn.evaluate((e) => {
        const s = getComputedStyle(e);
        return (s.outlineStyle !== "none" && Number.parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== "none" && /rgb/.test(s.boxShadow));
      });
      expect(ring, `${w}px: visible focus ring`).toBe(true);
    }
  });
});

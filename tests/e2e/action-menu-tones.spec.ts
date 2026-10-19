/**
 * L3 — action-menu tone colours against the real harness (computed styles:
 * `color-mix()` and theme tokens only resolve in a real browser).
 *
 * Covers test-plan #F1, #F3, #F11 (session menu). The tone rendering logic itself
 * is L1 (`SessionActionsMenu.tones.test.tsx`, `FolderActionsMenu.contributions.test.tsx`).
 * See change: colorize-actions-menus.
 */
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { colorDistance, contrastRatio, resolveColor, setThemeMode } from "./helpers/computed-contrast.js";
import { byTestId, ensureGitSession, gotoDashboard } from "./helpers/index.js";
import { closeSessionMenu, openSessionMenu, sessionMenuItem } from "./helpers/session-actions-menu.js";

const iconColor = (item: Locator): Promise<number[]> =>
  item.locator("svg").first().evaluate((e) => {
    const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    cv.fillStyle = "#000";
    cv.fillStyle = getComputedStyle(e).color;
    cv.fillRect(0, 0, 1, 1);
    const d = cv.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  });

const own = (el: Locator, prop: "color" | "backgroundColor"): Promise<number[]> =>
  el.evaluate((e, p) => {
    const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    cv.fillStyle = "#000";
    cv.fillStyle = getComputedStyle(e)[p as "color"];
    cv.fillRect(0, 0, 1, 1);
    const d = cv.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, prop);

async function openCardMenu(page: Page): Promise<void> {
  await ensureGitSession(page);
  await gotoDashboard(page);
  const card = byTestId(page, "sessionCardDesktop").first();
  await expect(card).toBeVisible();
  await openSessionMenu(page, card);
}

test.describe("action menu tones (L3)", () => {
  test.setTimeout(180_000);

  test("F1/F3: danger hover pins the label red; a neutral item stays untinted", async ({ page }) => {
    await openCardMenu(page);
    const exit = sessionMenuItem(page, "exit");
    await expect(exit).toHaveAttribute("data-action-tone", "danger");
    expect(colorDistance(await iconColor(exit), await resolveColor(page, "var(--accent-red-text)"))).toBeLessThanOrEqual(1);

    const rename = sessionMenuItem(page, "rename");
    await expect(rename).not.toHaveAttribute("data-action-tone", /.+/);

    await exit.hover();
    await expect.poll(async () => colorDistance(await own(exit, "backgroundColor"), await resolveColor(page, "var(--tint-red-bg)"))).toBeLessThanOrEqual(1);
    expect(colorDistance(await own(exit, "color"), await resolveColor(page, "var(--accent-red-text)"))).toBeLessThanOrEqual(1);
    await closeSessionMenu(page);
  });

  for (const [theme, mode] of [["base", "dark"], ["base", "light"], ["tokyo-night", "light"], ["catppuccin", "light"]] as const) {
    test(`F11: toned icons and the danger hover label meet contrast on ${theme} ${mode}`, async ({ page }) => {
      await ensureGitSession(page);
      await gotoDashboard(page);
      await setThemeMode(page, mode, theme);
      await openCardMenu(page);
      const surface = await resolveColor(page, "var(--bg-secondary)");
      const exit = sessionMenuItem(page, "exit");
      expect(contrastRatio(await iconColor(exit), surface)).toBeGreaterThanOrEqual(3);
      await exit.hover();
      await expect.poll(async () => colorDistance(await own(exit, "backgroundColor"), await resolveColor(page, "var(--tint-red-bg)"))).toBeLessThanOrEqual(1);
      expect(contrastRatio(await own(exit, "color"), await resolveColor(page, "var(--tint-red-bg)"))).toBeGreaterThanOrEqual(4.5);
      await closeSessionMenu(page);
    });
  }
});

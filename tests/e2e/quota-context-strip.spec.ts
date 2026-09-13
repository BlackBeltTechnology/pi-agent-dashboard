import { expect, type Page, test } from "./fixtures.js";
import { spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E — move-quota-to-context-strip.
 *
 * The quota widget left `content-inline-footer` (below the composer hints) for
 * the `composer-context-group` slot inside `ComposerSessionActions`, so it now
 * reads as a sibling of `OPENSPEC` / `GIT` / `STATUS` above the composer.
 *
 * `/api/quota` is stubbed with `page.route` (the harness has no provider
 * credentials); the real client component, slot mount and Dialog primitive are
 * exercised. Covers test-plan F7–F9 and X3.
 */

const ISO_FUTURE = (secsFromNow: number) =>
  new Date(Date.now() + secsFromNow * 1000).toISOString();

const QUOTA_BODY = {
  providers: [
    {
      provider: "anthropic",
      windows: [
        { label: "5h", usedPercent: 14, resetsAt: ISO_FUTURE(3 * 3600), windowSeconds: 5 * 3600 },
        { label: "7d", usedPercent: 32, resetsAt: ISO_FUTURE(4 * 86400), windowSeconds: 7 * 86400 },
      ],
    },
  ],
  unavailable: [],
};

/** Stub `/api/quota`, open a fresh session and return the live context strip. */
async function openSessionWithQuota(page: Page) {
  await page.route("**/api/quota", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(QUOTA_BODY) }),
  );
  const card = await spawnFreshGitSession(page);
  await card.click();
  const strip = page.getByTestId("composer-context-strip");
  await expect(strip).toBeVisible({ timeout: 30_000 });
  return strip;
}

test.describe("quota context strip", () => {
  test("F7: the Quota group renders in the strip with every window inline", async ({ page }) => {
    const strip = await openSessionWithQuota(page);

    const group = strip.getByTestId("quota-context-group");
    await expect(group).toBeVisible({ timeout: 20_000 });

    const chip = strip.getByTestId("quota-chip-anthropic");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("14%");
    await expect(chip).toContainText("32%");
    await expect(chip).toContainText("5h");
    await expect(chip).toContainText("7d");

    // The chip renders ONCE, in the strip — no duplicate quota widget elsewhere
    // (the old footer mount's wrapper carries no testid, so a `` footer``-scoped
    // locator would be structurally unfailable).
    await expect(page.getByTestId("quota-chip-anthropic")).toHaveCount(1);
  });

  test("F8: clicking the chip opens the shared dialog, Escape closes it", async ({ page }) => {
    const strip = await openSessionWithQuota(page);
    const chip = strip.getByTestId("quota-chip-anthropic");
    await expect(chip).toBeVisible({ timeout: 20_000 });
    await chip.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(page.getByTestId("quota-card-anthropic")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });

  test("F9: the label stays on the same line as its chips, inside the viewport", async ({ page }) => {
    const strip = await openSessionWithQuota(page);
    await page.setViewportSize({ width: 900, height: 800 });

    const group = strip.getByTestId("quota-context-group");
    await expect(group).toBeVisible({ timeout: 20_000 });

    const label = strip.getByTestId("quota-context-group-label");
    const chip = strip.getByTestId("quota-chip-anthropic");
    await expect(chip).toBeVisible();

    const labelBox = await label.boundingBox();
    const chipBox = await chip.boundingBox();
    const groupBox = await group.boundingBox();
    expect(labelBox).not.toBeNull();
    expect(chipBox).not.toBeNull();
    expect(groupBox).not.toBeNull();
    // Same flex line: the label's top and the first chip's top coincide.
    expect(Math.abs(labelBox!.y - chipBox!.y)).toBeLessThanOrEqual(4);
    // The group never leaves the left edge of the viewport.
    expect(groupBox!.x).toBeGreaterThanOrEqual(0);
  });

  test("X3: an aborted /api/quota degrades to no group, no uncaught error", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.route("**/api/quota", (route) => route.abort());
    const card = await spawnFreshGitSession(page);
    await card.click();

    const strip = page.getByTestId("composer-context-strip");
    await expect(strip).toBeVisible({ timeout: 30_000 });
    // The host strip survives the degraded plugin: its refresh control is still
    // there (a freshly spawned harness session has no worktree, so there is no
    // GIT group to anchor on).
    await expect(strip.getByTestId("statusbar-refresh-btn")).toBeVisible({ timeout: 15_000 });
    // …but no quota chip/group appears.
    await expect(page.getByTestId("quota-context-group")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});

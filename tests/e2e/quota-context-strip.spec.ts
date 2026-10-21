import { expect, type Page, test } from "./fixtures.js";
import { spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E — move-quota-to-context-strip, relocated by add-composer-dock.
 *
 * The quota widget renders through the `composer-dock`'s Context lane
 * (`composer-context-group` slot; the former composer context strip is gone), so
 * it reads as the dock's last lane directly above the composer card. The lane is
 * not expandable and its plugin groups are never working-gated.
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

/** Stub `/api/quota`, open a fresh session and return the dock's Context lane. */
async function openSessionWithQuota(page: Page) {
  await page.route("**/api/quota", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(QUOTA_BODY) }),
  );
  const card = await spawnFreshGitSession(page);
  await card.click();
  const dock = page.getByTestId("composer-dock");
  await expect(dock).toBeVisible({ timeout: 30_000 });
  const lane = dock.getByRole("group", { name: "Context", exact: true });
  await expect(lane).toBeVisible({ timeout: 20_000 });
  return lane;
}

test.describe("quota context lane", () => {
  test("F7: the Quota group renders in the Context lane with every window inline", async ({ page }) => {
    const lane = await openSessionWithQuota(page);

    const group = lane.getByTestId("quota-context-group");
    await expect(group).toBeVisible({ timeout: 20_000 });

    const chip = lane.getByTestId("quota-chip-anthropic");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("14%");
    await expect(chip).toContainText("32%");
    await expect(chip).toContainText("5h");
    await expect(chip).toContainText("7d");

    // The group is a named, dashed (read-only) ToolbarGroup and the chips carry
    // no border of their own. See change: redesign-composer-session-strip (D1).
    await expect(group).toHaveAttribute("role", "group");
    await expect(group).toHaveAttribute("data-group", "info");
    await expect(page.getByRole("group", { name: "Quota" })).toBeVisible();
    await expect(group).toHaveCSS("border-top-style", "dashed");
    await expect(chip).toHaveCSS("border-top-width", "0px");

    // The lane is a plain (non-expandable) header: no disclosure control in it.
    await expect(lane.locator("[data-dock-toggle]")).toHaveCount(0);

    // The chip renders ONCE, in the lane — no duplicate quota widget elsewhere
    // (the old footer mount's wrapper carries no testid, so a `` footer``-scoped
    // locator would be structurally unfailable).
    await expect(page.getByTestId("quota-chip-anthropic")).toHaveCount(1);
  });

  test("F8: clicking the chip opens the shared dialog, Escape closes it", async ({ page }) => {
    const lane = await openSessionWithQuota(page);
    const chip = lane.getByTestId("quota-chip-anthropic");
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
    const lane = await openSessionWithQuota(page);
    // Wide enough that the composer column (viewport minus the ~480 px sidebar) stays in the dock's
    // row layout (≥ 32.5rem = 520 px); at 1000 px the column is ~450 px and the dock goes compact,
    // where the Context lane is a chip and has no group to measure.
    await page.setViewportSize({ width: 1280, height: 800 });

    const group = lane.getByTestId("quota-context-group");
    await expect(group).toBeVisible({ timeout: 20_000 });

    const label = lane.getByTestId("quota-context-group-label");
    const chip = lane.getByTestId("quota-chip-anthropic");
    await expect(chip).toBeVisible();

    // A narrow group now wraps INSIDE its container (ToolbarGroup, D1), so the
    // label pairs with the group's FIRST item, which may be the no-adapter note
    // rather than a chip. See change: redesign-composer-session-strip.
    const first = group.locator("[data-group-content] > *").first();
    const labelBox = await label.boundingBox();
    const firstBox = await first.boundingBox();
    const chipBox = await chip.boundingBox();
    const groupBox = await group.boundingBox();
    expect(labelBox).not.toBeNull();
    expect(firstBox).not.toBeNull();
    expect(chipBox).not.toBeNull();
    expect(groupBox).not.toBeNull();
    // Same first line: the label text sits on the first item's row.
    const labelText = await label.evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      const b = r.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom };
    });
    expect(labelText.top).toBeGreaterThanOrEqual(firstBox!.y - 4);
    expect(labelText.bottom).toBeLessThanOrEqual(firstBox!.y + firstBox!.height + 4);
    // Chips never escape the group.
    expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(groupBox!.x + groupBox!.width + 1);
    // The group never leaves the left edge of the viewport.
    expect(groupBox!.x).toBeGreaterThanOrEqual(0);
  });

  test("X3: an aborted /api/quota degrades to no group, no uncaught error", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.route("**/api/quota", (route) => route.abort());
    const card = await spawnFreshGitSession(page);
    await card.click();

    // The composer survives the degraded plugin (a freshly spawned harness
    // session has no worktree, so the dock may not render at all)…
    await expect(page.getByTestId("composer-card")).toBeVisible({ timeout: 30_000 });
    // …but no quota chip/group appears, and no Context lane is left behind.
    await expect(page.getByRole("group", { name: "Context", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("quota-context-group")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});

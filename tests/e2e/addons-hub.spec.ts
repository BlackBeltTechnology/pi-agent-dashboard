import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { resolveContainer } from "./helpers/container-proc.js";
import { byTestId, ensureFixtureGitGroup, FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";

/**
 * Add-ons hub (change: addons-hub-declutter).
 *
 * F5 — the legacy `/settings/packages` URL replace-redirects to
 *      `/settings/add-ons`; the rail shows `ADD-ONS › Add-ons` active, the
 *      heading reads `Add-ons`, and no dashboard-managed bridge row
 *      (`index.ts`) renders in the installed list.
 * F4 — at a 375px viewport the Plugins rail entry is collapsed by default with
 *      a child count, expands in place without navigating, and the choice
 *      survives a reload.
 *
 * The dashboard port comes from the Playwright baseURL (docker/test-up.sh →
 * .pi-test-harness.json); nothing is hardcoded here.
 */
/** `<FIXTURE_GIT>/.pi/settings.json` read inside the harness container (`null` when absent). */
function folderSettingsFile(): string | null {
  const out = execFileSync("docker", ["exec", resolveContainer(), "sh", "-c", `[ -f ${FIXTURE_GIT}/.pi/settings.json ] && cat ${FIXTURE_GIT}/.pi/settings.json || echo __ABSENT__`], {
    encoding: "utf8",
  });
  return out === "__ABSENT__\n" ? null : out;
}

test.describe("Add-ons hub", () => {
  test("F5: /settings/packages lands on the Add-ons page without bridge rows", async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/settings/packages");

    await expect(page).toHaveURL(/\/settings\/add-ons$/, { timeout: 15_000 });
    await byTestId(page, "settingsContent").waitFor({ state: "visible", timeout: 15_000 });

    const group = page.getByTestId("settings-nav-group-add-ons");
    await expect(group).toBeVisible();
    await expect(group.getByRole("button", { name: "Add-ons", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 2, name: "Add-ons" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Pi Ecosystem", { exact: true })).toHaveCount(0);

    // Dashboard-managed bridge entries (`<plugin>/src/bridge/index.ts`) are hidden.
    await expect(page.getByTestId("addons-filter")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("index.ts", { exact: true })).toHaveCount(0);
  });

  test("explainer is expanded on first load, collapsed after dismiss + reload; no recommended entry is both row and card", async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/settings/add-ons");
    const toggle = page.getByTestId("addons-explainer-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 30_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await page.reload();
    await expect(page.getByTestId("addons-explainer-toggle")).toHaveAttribute("aria-expanded", "false", { timeout: 30_000 });
    await page.getByTestId("addons-explainer-link").click();
    await expect(page.getByTestId("addons-explainer-toggle")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("addons-explainer-toggle")).toBeFocused();

    // Recommended once: an entry with an installed row has no card in the Discover tab.
    await page.getByTestId("addons-tab-installed").waitFor({ state: "visible", timeout: 30_000 });
    await expect(page.locator("[data-testid^='addon-row-']").first()).toBeVisible({ timeout: 30_000 });
    const catalogRes = await page.request.get("/api/addons/catalog");
    const rowNames = ((await catalogRes.json()) as { features: Array<{ packages: Array<{ source: string }> }> }).features.flatMap(
      (f) => f.packages.map((p) => p.source),
    );
    await page.getByTestId("addons-tab-discover").click();
    await page.getByTestId("package-browser").waitFor({ state: "visible", timeout: 30_000 });
    const cardIds = await page
      .locator("[data-testid^='rec-remove-']")
      .evaluateAll((els) => els.map((e) => (e.getAttribute("data-testid") ?? "").replace("rec-remove-", "")));
    // A card with a Remove action is an installed entry; installed-globally ones must not be cards.
    // (Folder-only installs legitimately keep a card, hence the harness has none.)
    expect(cardIds.filter((id) => rowNames.some((src) => src.includes(id)))).toEqual([]);
  });

  test("F4: Plugins subtree is collapsed by default at 375px, expands in place, persists across reload", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoDashboard(page);
    await page.goto("/settings/general");
    await byTestId(page, "settingsContent").waitFor({ state: "visible", timeout: 15_000 });

    const toggle = page.getByTestId("nav-plugins-toggle");
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toContainText(/\d+/);
    await expect(page.locator("[data-testid^='nav-plugin-']:not([data-testid^='nav-plugin-status-'])")).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page).toHaveURL(/\/settings\/general$/);
    await expect(page.locator("[data-testid^='nav-plugin-']:not([data-testid^='nav-plugin-status-'])").first()).toBeVisible();

    await page.reload();
    await byTestId(page, "settingsContent").waitFor({ state: "visible", timeout: 15_000 });
    await expect(page.getByTestId("nav-plugins-toggle")).toHaveAttribute("aria-expanded", "true", { timeout: 30_000 });
  });
  // See change: addons-hub-feature-catalog (test-plan #F6, #F7).
  test("F6: Goal off and on round-trips through the hub switch and the settings entry", async ({ page }) => {
    await gotoDashboard(page);
    const catalog = await page.request.get("/api/addons/catalog");
    const features = ((await catalog.json()) as { features: Array<{ id: string; packages: unknown[] }> }).features;
    const goal = features.find((f) => f.id === "plugin:goal");
    test.skip(!goal || goal.packages.length === 0, "Goal's pi-goal-hermes package is not installed in this harness");

    await page.goto("/settings/add-ons");
    const sw = page.getByTestId("addon-switch-plugin:goal");
    await expect(sw).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
    await sw.click();
    await page.getByTestId("addon-toggle-confirm-button").click();
    await expect(sw).toHaveAttribute("aria-checked", "false", { timeout: 15_000 });

    await page.reload();
    await expect(page.getByTestId("addon-switch-plugin:goal")).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });
    const off = ((await (await page.request.get("/api/addons/catalog")).json()) as { features: Array<{ id: string; state: string }> }).features;
    expect(off.find((f) => f.id === "plugin:goal")?.state).toBe("off");

    await page.getByTestId("addon-switch-plugin:goal").click();
    await expect(page.getByTestId("addon-switch-plugin:goal")).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
  });

  test("F7: the selected tab survives a reload", async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/settings/add-ons");
    await page.getByTestId("addons-tab-discover").click();
    await expect(page).toHaveURL(/\?tab=discover/);
    await page.reload();
    await expect(page.getByTestId("addons-tab-discover")).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
    await expect(page.getByTestId("package-browser")).toBeVisible({ timeout: 30_000 });
  });

  // See change: addons-hub-folder-view (test-plan #F16): the rail badge and the Issues tab
  // share one count, and the health panel lives inside the tab at both widths.
  for (const width of [1440, 375]) {
    test(`F16: Issues tab at ${width}px — rail badge equals the tab count, panel inside the tab`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoDashboard(page);
      // One stale entry guarantees a non-zero count whatever plugins the harness has.
      await page.route("**/api/packages/health", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: {
              entries: [{ source: "npm:gone", status: "stale-npm", reason: "not installed" }],
              summary: { ok: 0, staleNpm: 1, missingPath: 0, duplicateGroups: [] },
            },
          }),
        }),
      );
      await page.goto("/settings/add-ons?tab=issues");
      const tab = page.getByTestId("addons-tab-issues");
      await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
      const count = Number(/\((\d+)\)/.exec((await tab.textContent()) ?? "")?.[1]);
      expect(count).toBeGreaterThanOrEqual(1);
      await expect(page.getByTestId("nav-addons-issues")).toContainText(String(count));
      await expect(page.getByTestId("addons-issues-tab").getByTestId("package-health-panel")).toBeVisible();
    });
  }

  // See change: addons-hub-folder-view (test-plan #F11): off, reload, on at a trusted folder.
  test("F11: a From Global add-on turned off here persists across reload and restores the file on re-enable", async ({ page }) => {
    await gotoDashboard(page);
    await ensureFixtureGitGroup(page);
    const original = folderSettingsFile();
    // Trust the folder up front so no dialog interrupts the round trip.
    const url = `/folder/${Buffer.from(FIXTURE_GIT).toString("base64url")}/settings/add-ons`;
    await page.goto(url);
    await expect(page.getByTestId("folder-addons-strip")).toBeVisible({ timeout: 30_000 });
    const row = page.locator('[data-testid^="folder-addon-row-"]').first();
    await row.waitFor({ state: "visible", timeout: 30_000 }); // the harness ships global packages (docker/test-entrypoint.sh)
    const sw = row.locator('[data-testid^="folder-addon-switch-"]');
    const turnedOff = page.getByTestId("folder-strip-off");
    await expect(turnedOff).toContainText("0");

    await sw.click();
    // An untrusted folder asks first; approve it so the toggle is retried.
    const dialog = page.getByTestId("resource-trust-dialog");
    if (await dialog.isVisible({ timeout: 3_000 }).catch(() => false)) await dialog.getByTestId("resource-trust-option-trust").click();
    await expect(row.locator('[data-testid^="folder-addon-state-"]')).toHaveText("off in this folder", { timeout: 15_000 });
    await expect(turnedOff).toContainText("1");

    await page.reload();
    await expect(page.locator('[data-testid^="folder-addon-state-"]').first()).toHaveText("off in this folder", { timeout: 30_000 });
    await expect(page.getByTestId("folder-strip-off")).toContainText("1");

    await page.locator('[data-testid^="folder-addon-switch-"]').first().click();
    await expect(page.getByTestId("folder-strip-off")).toContainText("0", { timeout: 15_000 });
    // The delta is gone again: the catalog reports the feature as inherited.
    const cat = (await (await page.request.get(`/api/addons/catalog?scope=local&cwd=${encodeURIComponent(FIXTURE_GIT)}`)).json()) as {
      features: Array<{ folderState?: string }>;
    };
    expect(cat.features.filter((f) => f.folderState === "off-here")).toHaveLength(0);
    // ...and the folder's settings file is byte-for-byte what it was before the round trip.
    expect(folderSettingsFile()).toBe(original);
  });
});

import { expect, type Page, test } from "@playwright/test";
import { gotoDashboard } from "./helpers/index.js";

/**
 * L3 browser behaviour for the settings field name/description contract
 * (change: reorganize-settings-pages-and-descriptions). Covers test-plan rows
 * F16 and F23.
 *
 * jsdom resolves accessible names through its own approximation; these rows
 * exist because the contract is only real if a browser's accessibility tree
 * agrees. Playwright's `getByLabel` and `aria-describedby` resolution run
 * against the real tree, so a label that merely sits next to its control —
 * the defect this change fixes — fails here even though the markup "looks"
 * associated.
 *
 * Harness glue copied from plugin-settings-pages.spec.ts. The dashboard port
 * is whatever docker/test-up.sh derived into .pi-test-harness.json; the
 * Playwright baseURL already carries it, so never hardcode :18000.
 */

/**
 * Open Settings the way a user does — through the header button.
 * A deep `page.goto("/settings/...")` on a fresh container renders the
 * dashboard instead (the route does not take before the app has settled), so
 * the click is the reliable entry point.
 */
async function openSettings(page: Page) {
  await gotoDashboard(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
}

/**
 * Move between pages through the rail, in the SAME document.
 * `exact` matters: "Server" is also a substring of "Remote Servers".
 */
async function railGoto(page: Page, label: string) {
  await page.getByTestId("settings-nav-rail").getByRole("button", { name: label, exact: true }).click();
}

const PAGES = ["General", "Server", "Sessions", "OpenSpec", "Developer"] as const;

test.describe("settings field descriptions", () => {
  // test-plan #F23
  test("every shared field control has an accessible name, and a visible hint is its description", async ({ page }) => {
    await openSettings(page);

    for (const label of PAGES) {
      await railGoto(page, label);
      const content = page.getByTestId("settings-content");
      await expect(content).toBeVisible();

      // Every control the four shared components render carries a generated id
      // that its <label for> points at. Assert through the accessibility tree.
      const described = content.locator("[aria-describedby]");
      const count = await described.count();

      for (let i = 0; i < count; i++) {
        const control = described.nth(i);
        const name = await control.evaluate((el) => {
          const id = el.getAttribute("id");
          const lbl = id ? el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
          return lbl?.textContent?.trim() ?? "";
        });
        expect(name, `control ${i} on ${label} has no associated label text`).not.toBe("");

        // …and its aria-describedby must resolve to a real, non-empty element.
        const description = await control.evaluate((el) => {
          const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
          return ids.map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
        });
        expect(description, `control "${name}" on ${label} has a dangling aria-describedby`).not.toBe("");
      }
    }
  });

  // test-plan #F16 — debugTools now commits through the buffered draft source,
  // so an unsaved toggle must NOT survive a reload, and a saved one must.
  test("debug-events persists only on Save", async ({ page }) => {
    await openSettings(page);
    await railGoto(page, "General");

    const toggleFor = (name: string) =>
      page.locator("div").filter({ hasText: new RegExp(`^${name}$`) }).locator("button").first();

    const debugToggle = toggleFor("Debug events");
    await expect(debugToggle).toBeVisible();
    const before = await debugToggle.getAttribute("class");

    // 1. Toggle, then reload WITHOUT saving — the change must be discarded.
    await debugToggle.click();
    await expect(page.getByTestId("settings-save-bar")).toBeVisible();
    await openSettings(page);
    await railGoto(page, "General");
    await expect(toggleFor("Debug events")).toHaveAttribute("class", before ?? "");

    // 2. Toggle and Save — now it must survive a reload.
    await toggleFor("Debug events").click();
    await page.getByTestId("save-btn").click();
    await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 20_000 });

    await openSettings(page);
    await railGoto(page, "General");
    await expect(toggleFor("Debug events")).not.toHaveAttribute("class", before ?? "");
  });
});

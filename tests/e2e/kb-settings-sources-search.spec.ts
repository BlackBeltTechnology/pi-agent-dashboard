import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard, pinDirectory } from "./helpers/index.js";

// KB settings — folder picker, remote-source trust state, and test search —
// browser E2E against the disposable Docker harness.
// Fixture: docker/fixtures/kb-sample (+ docs/guide.md, a uniquely headed file).
// Both scenarios REVERT their config edits so the shared fixture keeps the single
// "." source that kb-folder-slot.spec.ts asserts.
// See change: improve-kb-settings-sources-and-search (test-plan F10, F11).
const KB_FIXTURE = "/fixtures/kb-sample";

async function prepareShell(page: Page): Promise<void> {
  await gotoDashboard(page);
  const skip = page.getByRole("button", { name: /^skip$/i });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect(
    page.getByTestId("onboarding-step-2-cta").or(page.getByTestId("dashboard-add-folder-btn")).first(),
  ).toBeVisible({ timeout: 30_000 });
}

async function openSettings(page: Page): Promise<void> {
  await prepareShell(page);
  if ((await page.getByTestId(`folder-actions-menu-${KB_FIXTURE}`).count()) === 0) await pinDirectory(page, KB_FIXTURE);
  const kbRow = page.locator(
    `xpath=//*[@data-testid="folder-actions-menu-${KB_FIXTURE}"]/ancestor::div[.//*[@data-testid="folder-kb-section"]][1]//*[@data-testid="folder-kb-section"]`,
  );
  await expect(kbRow).toBeVisible({ timeout: 20_000 });
  await kbRow.getByTestId("folder-kb-open-settings").click();
  await expect(page.getByTestId("kb-settings-page")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("kb-source-row")).toHaveCount(1);
}

/** Remove every source row except the fixture's original "." and save (revert). */
async function revertSources(page: Page): Promise<void> {
  const rows = page.getByTestId("kb-source-row");
  while ((await rows.count()) > 1) {
    await rows.last().getByTestId("kb-source-remove").click();
  }
  if (await page.getByTestId("kb-save").isEnabled()) await page.getByTestId("kb-save").click();
  await expect(page.getByTestId("kb-dirty")).toContainText(/no changes/i, { timeout: 15_000 });
}

test.describe("KB settings — sources and search", () => {
  test("F10 pick a folder with Browse…, index it, and find a fixture heading with test search", async ({ page }) => {
    await openSettings(page);
    try {
      await page.getByTestId("kb-source-browse").click();
      const picker = page.getByTestId("path-picker-dialog");
      await expect(picker).toBeVisible();
      // Browse… opens INSIDE the folder. Click the `docs` row (immune to the picker's
      // late initial re-list that can clobber a typed value), then confirm.
      const docsRow = picker.getByRole("option", { name: /docs/ });
      await docsRow.waitFor({ state: "visible", timeout: 20_000 });
      await docsRow.click();
      await expect(picker.getByRole("textbox").first()).toHaveValue(`${KB_FIXTURE}/docs/`);
      await picker.getByRole("button", { name: /^select$/i }).click();

      // Inside the folder → stored relative; the picker closes; a second row appears.
      await expect(picker).toBeHidden();
      await expect(page.getByTestId("kb-source-row")).toHaveCount(2);
      await expect(page.getByTestId("kb-source-row").last()).toContainText("docs");
      await expect(page.getByTestId("kb-source-row").last()).not.toContainText(KB_FIXTURE);

      await page.getByTestId("kb-save-reindex").click();
      await expect(page.getByTestId("kb-dirty")).toContainText(/no changes/i, { timeout: 15_000 });

      // The index is rebuilt server-side; retry the search until the new file lands.
      await expect(async () => {
        await page.getByTestId("kb-search-input").fill("Zanzibar Quokka Protocol");
        await page.getByTestId("kb-search-submit").click();
        const hits = page.getByTestId("kb-search-hit");
        await expect(hits.first()).toBeVisible({ timeout: 5_000 });
        const top3 = (await hits.allTextContents()).slice(0, 3).join("\n");
        expect(top3).toContain("guide.md");
      }).toPass({ timeout: 45_000 });
    } finally {
      await revertSources(page);
    }
  });

  test("F11 an untrusted remote source is shown as not trusted and is never fetched", async ({ page }) => {
    await openSettings(page);
    try {
      const countBefore = await page.getByTestId("kb-config-count").textContent();
      await page.getByTestId("kb-source-kind-git").click();
      await page.getByTestId("kb-source-input").fill("https://github.com/example/never");
      await page.getByTestId("kb-source-add").click();
      await expect(page.getByTestId("kb-trust-dialog")).toBeVisible();
      await page.getByTestId("kb-trust-add-untrusted").click();
      await expect(page.getByTestId("kb-source-row")).toHaveCount(2);

      await page.getByTestId("kb-save-reindex").click();
      await expect(page.getByTestId("kb-source-untrusted")).toBeVisible({ timeout: 30_000 });
      // The job is skipped-not-failed: no error region, counts unchanged.
      await expect(page.getByTestId("kb-settings-error")).toHaveCount(0);
      await expect(page.getByTestId("kb-config-count")).toHaveText(countBefore ?? "", { timeout: 30_000 });
    } finally {
      await revertSources(page);
    }
  });
});

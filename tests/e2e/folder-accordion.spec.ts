/**
 * Browser E2E — accordion folder list: chevron semantics and persistence of
 * pinned-open folders. Scenarios: test-plan #F6 (+ pinned-open reload).
 * See change: add-focus-mode-and-card-block-toggles.
 */
import { expect, test } from "./fixtures.js";
import { setExpandedViaBus } from "./helpers/card-sections.js";
import { inContainer, pinViaBus, setFolderCollapsedViaBus, unpinViaBus } from "./helpers/folder-collapse.js";
import { ensureGitSession, expandFolder, FIXTURE_GIT, folderCard, gotoDashboard } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

async function setFolderListMode(page: import("./fixtures.js").Page, mode: "classic" | "accordion"): Promise<void> {
  const res = await page.request.put("/api/config", { data: { folderListMode: mode } });
  expect(res.ok()).toBe(true);
}

test.describe("folder accordion", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  test.afterAll(async () => {
    await fetch(`${BASE_URL}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderListMode: "classic" }),
    });
    await setExpandedViaBus(FIXTURE_GIT, false);
    await setFolderCollapsedViaBus(FIXTURE_GIT, false);
  });

  test("F6: header body focuses without touching collapse; chevron collapses the focused folder", async ({ page }) => {
    // Start from classic: a previous test leaves the shared container in
    // accordion mode, where an unfocused fixture folder renders compact and
    // ensureGitSession cannot find its body.
    await setFolderListMode(page, "classic");
    await ensureGitSession(page);
    await setFolderListMode(page, "accordion");
    await gotoDashboard(page);
    await expandFolder(page, FIXTURE_GIT);

    // Header body: focus only — the body stays mounted, the chevron stays ▾.
    await page.getByTestId(`folder-header-name-${FIXTURE_GIT}`).click();
    await expect(page.getByTestId(`folder-body-${FIXTURE_GIT}`)).toHaveCount(1);

    // Chevron on the focused folder collapses it (server echo).
    await folderCard(page, FIXTURE_GIT).getByTestId("folder-toggle-btn").first().click();
    await expect(page.getByTestId(`folder-body-${FIXTURE_GIT}`)).toHaveCount(0);
    await folderCard(page, FIXTURE_GIT).getByTestId("folder-toggle-btn").first().click();
    await expect(page.getByTestId(`folder-body-${FIXTURE_GIT}`)).toHaveCount(1);
  });

  test("pinned-open folders persist across a reload (server state)", async ({ page }) => {
    // Start from classic: a previous test leaves the shared container in
    // accordion mode, where an unfocused fixture folder renders compact and
    // ensureGitSession cannot find its body.
    await setFolderListMode(page, "classic");
    await ensureGitSession(page);
    await setFolderListMode(page, "accordion");
    await setExpandedViaBus(FIXTURE_GIT, true);
    await gotoDashboard(page);
    await expect(page.getByTestId(`folder-body-${FIXTURE_GIT}`)).toHaveCount(1, { timeout: 30_000 });
  });

  // S38 (#1134): a compact-empty folder is ONE header row — never taller than the
  // same folder collapsed in classic mode, with no Group-by / compact-count row.
  // The folder is empty (header only) so both modes show the same name and count.
  // See change: sidebar-folder-ux.
  test("S38: a compact-empty accordion folder is no taller than a classic collapsed one", async ({ page }) => {
    const DIR = "/root/e2e-slim-card";
    inContainer(`mkdir -p ${DIR}`);
    await pinViaBus(DIR);
    try {
      await setFolderListMode(page, "classic");
      await setFolderCollapsedViaBus(DIR, true);
      await gotoDashboard(page);
      const classicCard = folderCard(page, DIR);
      await expect(classicCard).toBeVisible({ timeout: 30_000 });
      const classicBox = await classicCard.boundingBox();

      await setFolderListMode(page, "accordion");
      await gotoDashboard(page);
      const compactCard = folderCard(page, DIR);
      await expect(compactCard).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(`folder-body-${DIR}`)).toHaveCount(0);
      await expect(page.getByTestId(`folder-group-by-row-${DIR}`)).toHaveCount(0);
      await expect(page.getByTestId(`folder-compact-row-${DIR}`)).toHaveCount(0);
      const compactBox = await compactCard.boundingBox();

      expect(classicBox && compactBox).toBeTruthy();
      expect(compactBox!.height).toBeLessThanOrEqual(classicBox!.height + 0.5);
    } finally {
      await setFolderCollapsedViaBus(DIR, false);
      await unpinViaBus(DIR);
    }
  });
});

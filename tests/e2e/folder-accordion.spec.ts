/**
 * Browser E2E — accordion folder list: chevron semantics and persistence of
 * pinned-open folders. Scenarios: test-plan #F6 (+ pinned-open reload).
 * See change: add-focus-mode-and-card-block-toggles.
 */
import { expect, test } from "./fixtures.js";
import { setExpandedViaBus } from "./helpers/card-sections.js";
import { setFolderCollapsedViaBus } from "./helpers/folder-collapse.js";
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
});

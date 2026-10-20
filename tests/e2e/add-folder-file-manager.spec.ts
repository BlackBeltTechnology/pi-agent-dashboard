/**
 * Browser E2E — Add Folders dialog with file-manager gestures.
 * Scenarios: test-plan #F4 (real dblclick opens), #F17 (44 px touch rows),
 * #F18 (touch tap opens, long-press selects, commit two), #E16 (pinDirectory
 * on a touch context pins exactly the requested path).
 * See change: simplify-add-folder-picker.
 */
import { connectBus, expect, type Page, test } from "./fixtures.js";
import { gotoDashboard, pinDirectory } from "./helpers/index.js";

// Fixtures live under the server's default browse dir (HOME, an allowed root);
// `/tmp` is outside the allowed roots (mkdir → 403). Resolved in beforeAll.
const PARENT_NAME = "afm-file-manager-fixture";
let ROOT = "";
let PARENT = "";

async function mkdir(page: Page, parent: string, name: string): Promise<void> {
  const res = await page.request.post("/api/browse/mkdir", { data: { parent, name } });
  // 409 = already created by an earlier test in this file.
  expect([200, 409]).toContain(res.status());
}

async function pinnedDirs(page: Page): Promise<string[]> {
  const res = await page.request.get("/api/pinned-dirs");
  const body = (await res.json()) as { data?: string[] | { dirs?: string[] } };
  const d = body.data;
  return Array.isArray(d) ? d : (d?.dirs ?? []);
}

async function unpin(paths: string[]): Promise<void> {
  const client = await connectBus();
  try {
    for (const path of paths) client.send({ type: "unpin_directory", path });
    await new Promise((r) => setTimeout(r, 500));
  } finally {
    client.close();
  }
}

/** Resolve the browse root and create `<root>/afm-…/{leaf-a,leaf-b}` (idempotent). */
async function ensureFixture(browser: import("@playwright/test").Browser): Promise<void> {
  const page = await browser.newPage();
  try {
    await gotoDashboard(page);
    const home = (await (await page.request.get("/api/browse")).json()) as { data: { current: string } };
    ROOT = home.data.current;
    PARENT = `${ROOT}/${PARENT_NAME}`;
    await mkdir(page, ROOT, PARENT_NAME);
    await mkdir(page, PARENT, "leaf-a");
    await mkdir(page, PARENT, "leaf-b");
  } finally {
    await page.close();
  }
}

async function openAddFolders(page: Page) {
  await gotoDashboard(page);
  // Fresh harness → onboarding CTA; otherwise the sidebar button. Wait for
  // whichever renders first (a one-shot isVisible() races the first paint).
  const entry = page.getByTestId("onboarding-step-2-cta").or(page.getByTestId("dashboard-add-folder-btn")).first();
  await entry.waitFor({ state: "visible", timeout: 20_000 });
  await entry.click();
  const dialog = page.getByTestId("add-folders-dialog");
  await dialog.waitFor({ state: "visible" });
  // The first browse has landed once the status names a target (or the home notice).
  await expect(
    dialog.getByTestId("add-folders-status-path").or(dialog.getByTestId("add-folders-status-home")),
  ).toBeVisible({ timeout: 20_000 });
  return dialog;
}

async function browseTo(dialog: ReturnType<Page["getByTestId"]>, dir: string) {
  const textbox = dialog.getByRole("textbox").first();
  await textbox.fill(`${dir}/`);
  await expect(dialog.getByTestId("add-folders-status-path")).toHaveText(dir, { timeout: 20_000 });
}

test.describe("add folder — file-manager picker", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  test.beforeAll(async ({ browser }) => ensureFixture(browser));

  test.afterAll(async () => {
    await unpin([PARENT, `${PARENT}/leaf-a`, `${PARENT}/leaf-b`]);
  });

  test("#F4 desktop: click selects, double-click opens", async ({ page }) => {
    const dialog = await openAddFolders(page);
    await browseTo(dialog, PARENT);
    const rowA = dialog.getByTestId(`path-picker-row-${PARENT}/leaf-a`);
    await rowA.click();
    await expect(rowA).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByTestId("add-folders-commit")).toHaveText('Add "leaf-a"');
    await rowA.dblclick();
    await expect(dialog.getByTestId("add-folders-status-path")).toHaveText(`${PARENT}/leaf-a`, { timeout: 20_000 });
    await expect(dialog.getByRole("textbox").first()).toHaveValue(`${PARENT}/leaf-a/`);
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });
});

test.describe("add folder — touch", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test.beforeAll(async ({ browser }) => ensureFixture(browser));

  test.afterAll(async () => {
    await unpin([`${PARENT}/leaf-a`, `${PARENT}/leaf-b`, `${PARENT}/leaf-a`]);
  });

  test("#F17 rows are at least 44 px on a coarse pointer", async ({ page }) => {
    const dialog = await openAddFolders(page);
    await browseTo(dialog, PARENT);
    const rows = dialog.locator("[data-testid^='path-picker-row-']");
    await expect(rows).toHaveCount(2);
    for (const box of await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("#F18 tap opens; long-press selects; commit adds both", async ({ page }) => {
    const dialog = await openAddFolders(page);
    await browseTo(dialog, PARENT);
    const rowA = dialog.getByTestId(`path-picker-row-${PARENT}/leaf-a`);
    await rowA.tap();
    await expect(dialog.getByTestId("add-folders-status-path")).toHaveText(`${PARENT}/leaf-a`, { timeout: 20_000 });
    await dialog.getByRole("option", { name: ".." }).tap();
    await expect(dialog.getByTestId("add-folders-status-path")).toHaveText(PARENT, { timeout: 20_000 });

    // Long-press via a held touch: dispatch pointerdown, wait past 400 ms, pointerup.
    const box = await dialog.getByTestId(`path-picker-row-${PARENT}/leaf-a`).boundingBox();
    if (!box) throw new Error("leaf-a row has no box");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await dialog.getByTestId(`path-picker-row-${PARENT}/leaf-a`).dispatchEvent("pointerdown", {
      pointerType: "touch", clientX: cx, clientY: cy, isPrimary: true, bubbles: true,
    });
    await page.waitForTimeout(550);
    await dialog.getByTestId(`path-picker-row-${PARENT}/leaf-a`).dispatchEvent("pointerup", {
      pointerType: "touch", clientX: cx, clientY: cy, isPrimary: true, bubbles: true,
    });
    await expect(dialog.getByTestId(`path-picker-row-${PARENT}/leaf-a`)).toHaveAttribute("aria-selected", "true");
    await dialog.getByTestId(`path-picker-row-${PARENT}/leaf-b`).tap();
    const commit = dialog.getByTestId("add-folders-commit");
    await expect(commit).toHaveText("Add 2 folders");
    await commit.tap();
    await dialog.waitFor({ state: "hidden" });
    await expect.poll(() => pinnedDirs(page)).toEqual(
      expect.arrayContaining([`${PARENT}/leaf-a`, `${PARENT}/leaf-b`]),
    );
  });

  test("#E16 pinDirectory on a touch context pins exactly the requested path", async ({ page }) => {
    await unpin([`${PARENT}/leaf-a`]);
    await gotoDashboard(page);
    await pinDirectory(page, `${PARENT}/leaf-a`);
    const pinned = await pinnedDirs(page);
    expect(pinned).toContain(`${PARENT}/leaf-a`);
    expect(pinned).not.toContain(PARENT);
  });
});

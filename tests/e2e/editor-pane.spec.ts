import { expect, test } from "@playwright/test";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — internal Monaco editor pane (change: add-internal-monaco-editor-pane).
//
// Drives the real OpenFileButton → editor-pane round-trip against the Docker
// harness, opening files that REALLY exist in the sample-git fixture
// (`README.md`, `hello.txt`) so the server can serve them.
//
// Faux round-trip: `[[faux:tool-read-fixture]]` streams a `read` tool call for
// `README.md`; the ReadToolRenderer mounts an OpenFileButton whose body click
// navigates to `/session/:id/editor?file=README.md`. Requires PI_E2E_SEED=1
// (managed mode sets it automatically).
//
// Covers manual tasks 8.3 (pane opens + tabs + restore), 8.4 (viewer kinds:
// markdown / monaco / image / pdf), 8.5 (split button → internal pane).
// Pixel-exact theme fidelity (8.4a) still needs a human eye; here we prove the
// Monaco editor mounts and inherits a concrete (non-transparent) background.
//
// Image/PDF coverage uses the binary fixtures `logo.png` + `doc.pdf` seeded
// in docker/fixtures/sample-git/.

test.describe("internal Monaco editor pane", () => {
  test("OpenFileButton opens the pane; markdown + monaco viewers render real fixture files", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    // Faux read of a real fixture file → OpenFileButton appears.
    await sendPrompt(page, "[[faux:tool-read-fixture]] go");
    const openBtn = page.getByTitle("Open README.md");
    await expect(openBtn).toBeVisible({ timeout: 30_000 });

    // Body click → internal editor pane route.
    await openBtn.click();
    await expect(page).toHaveURL(/\/session\/[^/]+\/editor\?file=README\.md/, { timeout: 15_000 });

    // README.md → MarkdownViewer renders the heading from the fixture file.
    await expect(page.getByRole("heading", { name: "sample-git" })).toBeVisible({ timeout: 20_000 });

    // Open hello.txt from the tree rail → second tab + Monaco renders its text.
    await page.getByText("hello.txt", { exact: true }).first().click();
    await expect(page.getByText("hello from the sample-git fixture")).toBeVisible({ timeout: 30_000 });

    // The Monaco editor mounted and inherits a concrete (non-transparent) bg,
    // proving the derived theme applied (buildMonacoTheme → editor.background).
    const monaco = page.locator(".monaco-editor").first();
    await expect(monaco).toBeVisible({ timeout: 30_000 });
    const bg = await monaco
      .locator(".monaco-editor-background")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(bg).not.toBe("transparent");

    // Open logo.png from the tree → ImageViewer streams it from /api/file/raw.
    await page.getByText("logo.png", { exact: true }).first().click();
    const img = page.locator('img[src*="/api/file/raw"][src*="logo.png"]');
    await expect(img).toBeVisible({ timeout: 20_000 });

    // Open doc.pdf from the tree → PdfViewer mounts an <object> over /api/file/raw.
    await page.getByText("doc.pdf", { exact: true }).first().click();
    const pdf = page.locator('object[type="application/pdf"][data*="doc.pdf"]');
    await expect(pdf).toBeAttached({ timeout: 20_000 });

    // Four tabs open (README.md, hello.txt, logo.png, doc.pdf).
    await expect(page.getByRole("tab")).toHaveCount(4);

    // Back-to-chat returns to the session and preserves pane state.
    await page.getByText("Back", { exact: true }).first().click();
    await expect(page).toHaveURL(/\/session\/[^/]+$/, { timeout: 15_000 });
    await expect(page.getByPlaceholder(/message/i).first()).toBeVisible({ timeout: 15_000 });

    // Re-entering the editor restores all persisted tabs (localStorage).
    await page.goBack();
    await expect(page.getByRole("tab")).toHaveCount(4, { timeout: 20_000 });
  });
});

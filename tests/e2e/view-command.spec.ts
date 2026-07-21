import { expect, type Page, test } from "@playwright/test";
import { byTestId, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — `/view` opens its target in the editor pane (change:
// open-view-command-in-editor-pane). Replaces the retired inline `PreviewCard`
// surface: `/view @<file>` and `/view <url>` navigate to
// `/session/:id/editor?file=…|url=…`; `SplitRouteSync` bridges the param into
// the split. Fixtures (README.md, data.csv, report.docx, *.eml) live in
// docker/fixtures/sample-git/, copied to the session cwd at container start.

/** Dismiss the harness's recurring spawn toasts (they intercept the send button). */
async function dismissToasts(page: Page): Promise<void> {
  for (const btn of await page.getByRole("button", { name: "Dismiss" }).all()) {
    await btn.click().catch(() => {});
  }
}

/** `/view <arg>` in the composer; returns after send (toast-robust). */
async function runView(page: Page, arg: string): Promise<void> {
  const composer = page.getByPlaceholder(/message/i).first();
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await composer.fill(`/view ${arg}`);
  await page.keyboard.press("Escape"); // close any slash-command dropdown
  await composer.fill(`/view ${arg}`);
  await expect(async () => {
    await dismissToasts(page);
    await byTestId(page, "sendButton").click({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

async function openSession(page: Page) {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await page.getByPlaceholder(/message/i).first().waitFor({ state: "visible", timeout: 30_000 });
  return card;
}

test.describe("/view opens the editor pane", () => {
  test("F1: /view @README.md opens the pane with the markdown viewer; ZERO inline card", async ({ page }) => {
    await openSession(page);
    await runView(page, "@README.md");
    await expect(page).toHaveURL(/\/session\/[^/]+\/editor\?file=README\.md/, { timeout: 20_000 });
    // Rendered markdown (fixture heading), not raw source.
    await expect(page.getByRole("heading", { name: "sample-git" })).toBeVisible({ timeout: 20_000 });
    // The retired inline PreviewCard never appears in the transcript.
    await expect(page.getByTestId("preview-card")).toHaveCount(0);
  });

  test("F2: /view <youtube url> mounts the UrlViewer embed; no inline card", async ({ page }) => {
    await openSession(page);
    await runView(page, "https://youtu.be/dQw4w9WgXcQ");
    await expect(page).toHaveURL(/\/session\/[^/]+\/editor\?url=/, { timeout: 20_000 });
    await expect(page.getByTestId("canvas-url-viewer")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("preview-card")).toHaveCount(0);
  });

  test("F3: a copied ?url= reload reopens the URL tab, no canvas oscillation", async ({ page }) => {
    const card = await openSession(page);
    await runView(page, "https://example.com/");
    await expect(page.getByTestId("canvas-url-viewer")).toBeVisible({ timeout: 20_000 });
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();
    // Reload the copied deep-link fresh → SplitRouteSync reopens the URL tab.
    await page.goto(`/session/${sessionId}/editor?url=${encodeURIComponent("https://example.com/")}`);
    await expect(page.getByTestId("canvas-url-viewer")).toBeVisible({ timeout: 20_000 });
    // Exactly one URL viewer — no duplicate/oscillating open.
    await expect(page.getByTestId("canvas-url-viewer")).toHaveCount(1);
  });

  test("F4: ?file= and ?url= together → file wins, no URL tab (D6)", async ({ page }) => {
    const card = await openSession(page);
    // Reach a session, then load the malformed combined deep-link directly.
    await runView(page, "@README.md");
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();
    await page.goto(`/session/${sessionId}/editor?file=README.md&url=${encodeURIComponent("https://example.com/")}`);
    // File wins → markdown viewer; the URL viewer is NOT mounted.
    await expect(page.getByRole("heading", { name: "sample-git" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("canvas-url-viewer")).toHaveCount(0);
  });

  test("F5: /view @data.csv → spreadsheet grid; Preview↔Edit toggle mounts Monaco over raw CSV", async ({ page }) => {
    await openSession(page);
    await runView(page, "@data.csv");
    await expect(page).toHaveURL(/\/session\/[^/]+\/editor\?file=data\.csv/, { timeout: 20_000 });
    // Preview mode → spreadsheet grid (not Monaco).
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".monaco-editor")).toHaveCount(0);
    // Edit → Monaco text buffer over the raw CSV.
    await page.getByTestId("csv-edit-toggle").click();
    await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
    // Back to Preview → grid restored.
    await page.getByTestId("csv-preview-toggle").click();
    await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 20_000 });
  });

  test("F7: /view @report.docx opens a rich (non-Monaco) viewer, never raw Monaco, no inline card", async ({ page }) => {
    await openSession(page);
    await runView(page, "@report.docx");
    await expect(page).toHaveURL(/\/session\/[^/]+\/editor\?file=report\.docx/, { timeout: 20_000 });
    // Office kind → DocxPreview (rendered), NOT a Monaco raw-bytes buffer, and
    // NOT the retired inline PreviewCard. A tab for the file is present.
    await expect(page.getByRole("tab").filter({ hasText: "report.docx" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".monaco-editor")).toHaveCount(0);
    await expect(page.getByTestId("preview-card")).toHaveCount(0);
  });

  // F6 (cross-surface parity: tree + FileLink + /view all mount the same rich
  // viewer) is covered at L1 by viewer-registry.test.tsx (the shared registry
  // mapping every surface dispatches through) + FilePreviewOverlay.test.tsx
  // (FileLink surface routes rich kinds), and end-to-end for /view by F7 above.
  // The file-tree-rail interaction is layout-state flaky and adds no invariant
  // beyond the shared-registry guarantee, so it stays at L1.

  test("X1: an unrenderable .docx degrades to an inline fallback, never raw Monaco / crash", async ({ page }) => {
    // Force the server render to fail → DocxPreview's FallbackPreview path.
    await page.route("**/api/file/render**", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: "render failed" }) }),
    );
    await openSession(page);
    await runView(page, "@report.docx");
    await expect(page).toHaveURL(/\/session\/[^/]+\/editor\?file=report\.docx/, { timeout: 20_000 });
    await expect(page.getByTestId("preview-fallback")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".monaco-editor")).toHaveCount(0);
  });
});

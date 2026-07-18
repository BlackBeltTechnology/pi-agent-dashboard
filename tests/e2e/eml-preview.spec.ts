import { expect, type Page, test } from "@playwright/test";
import { byTestId, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — EML (email) preview in the editor pane.
//
// `/view @<file.eml>` now opens the target in the SPLIT EDITOR PANE (change:
// open-view-command-in-editor-pane) — NOT the retired inline `PreviewCard`.
// `fileKind` classifies `.eml` → `email` → `viewerRegistry.email` → the same
// shared `EmlPreview` component. Fixtures live in docker/fixtures/sample-git/
// (rich.eml, lazy.eml), copied to /fixtures/sample-git (the session cwd) at
// container start.
//
// Security asserts (opaque-origin sandbox, escaped headers, remote-block,
// cid→blob, lazy attachments) mirror the reused EmlPreview posture (test-plan
// X4) and are unchanged by the surface move.

/** Dismiss the harness's recurring "Pi session spawned" toasts (they sit at
 * `fixed top-4 right-4` and intercept the send button). */
async function dismissToasts(page: Page): Promise<void> {
  for (const btn of await page.getByRole("button", { name: "Dismiss" }).all()) {
    await btn.click().catch(() => {});
  }
}

/** `/view @<file>` → wait for the editor-pane EmlPreview to mount. */
async function openEml(page: Page, file: string) {
  const composer = page.getByPlaceholder(/message/i).first();
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await composer.fill(`/view @${file}`);
  // Close any slash-command dropdown, then click send past overlapping toasts.
  await page.keyboard.press("Escape");
  await composer.fill(`/view @${file}`);
  await expect(async () => {
    await dismissToasts(page);
    await byTestId(page, "sendButton").click({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  // Routes to the editor pane deep-link; the active tab mounts EmlPreview.
  await expect(page).toHaveURL(new RegExp(`/session/[^/]+/editor\\?file=${file.replace(".", "\\.")}`), {
    timeout: 20_000,
  });
  const preview = page.getByTestId("eml-preview");
  await expect(preview).toBeVisible({ timeout: 30_000 });
  return preview;
}

test.describe("EML preview in the editor pane", () => {
  test("no inline card; body isolation, escaped headers, remote-block, cid, lazy attachments (X4)", async ({
    page,
  }) => {
    // The tracking-pixel host must never be hit. Count + block it.
    let trackerHits = 0;
    await page.route("**tracker.example**", (route) => {
      trackerHits++;
      return route.abort();
    });
    // Any sandbox escape would raise a dialog; fail if one fires.
    let dialogFired = false;
    page.on("dialog", (d) => {
      dialogFired = true;
      void d.dismiss();
    });
    const card = await spawnFreshGitSession(page);
    await card.click();

    // ── rich.eml: the everything fixture ──────────────────────────────────
    const rich = await openEml(page, "rich.eml");

    // The retired inline surface must NOT appear in the transcript.
    await expect(page.getByTestId("preview-card")).toHaveCount(0);

    const frame = rich.getByTestId("eml-body-frame");

    // X4 — body iframe sandbox is EXACTLY "" (opaque origin, no allow-same-origin).
    await expect(frame).toHaveAttribute("sandbox", "");

    // Escaped headers — the XSS subject is literal escaped text (no element, no alert).
    await expect(rich).toContainText("onerror=alert(1)");
    expect(dialogFired).toBe(false);

    // Header starts collapsed; clicking it reveals from/to/date/subject.
    await expect(rich.getByTestId("eml-header-full")).toHaveCount(0);
    await rich.getByTestId("eml-header-toggle").click();
    const full = rich.getByTestId("eml-header-full");
    await expect(full).toBeVisible();
    await expect(full).toContainText("alice@example.com");
    await expect(full).toContainText("bob@example.com");

    // cid: refs resolve to blob: URLs before srcDoc build.
    await expect
      .poll(async () => (await frame.getAttribute("srcdoc")) ?? "", { timeout: 15_000 })
      .toContain("blob:");
    const srcdoc = (await frame.getAttribute("srcdoc")) ?? "";
    expect(srcdoc).not.toContain("cid:logo");

    // X4 — remote tracker image blocked on render; "Load remote content" shown.
    expect(trackerHits).toBe(0);
    const banner = rich.getByTestId("eml-load-remote");
    await expect(banner).toBeVisible();

    // Activating the banner re-requests the body with ?allowRemote=1 (the
    // browser fetches remote content; the server never does).
    const remoteReq = page.waitForRequest(
      (r) => r.url().includes("/api/file/eml?") && r.url().includes("allowRemote=1"),
      { timeout: 30_000 },
    );
    await banner.click();
    await remoteReq;
    await expect(rich.getByTestId("eml-load-remote")).toHaveCount(0);

    // Attachments: PDF(report.pdf)=previewable, JPEG(photo.jpg)=previewable,
    // DOCX(notes.docx)=download-only.
    const pdfRow = rich.getByTestId("eml-attachment").filter({ hasText: "report.pdf" });
    const jpgRow = rich.getByTestId("eml-attachment").filter({ hasText: "photo.jpg" });
    const docxRow = rich.getByTestId("eml-attachment").filter({ hasText: "notes.docx" });

    // The .docx row offers download only (no expand affordance).
    await expect(docxRow.getByTestId("eml-attachment-download")).toBeVisible();
    await expect(docxRow.getByTestId("eml-attachment-expand")).toHaveCount(0);

    // Expanding the PDF row renders PdfPreview inline from a blob: URL.
    const urlBefore = page.url();
    await pdfRow.getByTestId("eml-attachment-expand").click();
    await expect(pdfRow.locator("canvas")).toBeVisible({ timeout: 30_000 });
    expect(page.url()).toBe(urlBefore);

    // Expanding the image row renders ImagePreview inline via a blob: URL.
    await jpgRow.getByTestId("eml-attachment-expand").click();
    await expect(jpgRow.locator('img[src^="blob:"]')).toBeVisible({ timeout: 20_000 });

    // ── lazy.eml: attachment bytes fetched only on expand ─────────────────
    let attachmentReqs = 0;
    await page.route("**/api/file/eml-attachment**", (route) => {
      if (route.request().url().includes("lazy.eml")) attachmentReqs++;
      return route.continue();
    });
    const lazy = await openEml(page, "lazy.eml");
    // No attachment request has fired before any row is expanded.
    await expect(lazy).toBeVisible();
    expect(attachmentReqs).toBe(0);
    await lazy.getByTestId("eml-attachment-expand").first().click();
    await expect.poll(() => attachmentReqs, { timeout: 20_000 }).toBeGreaterThan(0);
  });
});

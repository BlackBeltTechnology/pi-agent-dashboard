import { expect, type Page, test } from "@playwright/test";
import { byTestId, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — EML (email) preview (change: add-eml-preview).
//
// Drives the real `/view @<file.eml>` composer command against the Docker
// harness. `/view` creates a dashboard-local view-bearing message → an inline
// `PreviewCard` whose body dispatches (`dispatchPreview` → "email") to
// `EmlPreview`. Fixtures live in docker/fixtures/sample-git/ (rich.eml, lazy.eml),
// copied to /fixtures/sample-git (the session cwd) at container start.
//
// Security asserts (opaque-origin sandbox, escaped headers, remote-block, cid→blob)
// mirror the D2/D3 design decisions; attachment asserts mirror D4.

/** Send `/view @<file>` and wait for the inline EmlPreview to mount. */
async function openEml(page: Page, file: string) {
  const composer = page.getByPlaceholder(/message/i).first();
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await composer.fill(`/view @${file}`);
  await byTestId(page, "sendButton").click();
  // `/view` appends a card; scope to the newest one so repeated calls don't
  // match earlier email cards still in the transcript.
  const card = page.getByTestId("preview-card").filter({ has: page.getByTestId("eml-preview") }).last();
  await expect(card).toBeVisible({ timeout: 30_000 });
  return card;
}

test.describe("EML preview", () => {
  test("body isolation, escaped headers, expand, attachments, remote-block, cid (test-plan #22–32)", async ({
    page,
  }) => {
    // Route .eml previews to the overlay/inline renderer, never an editor.
    await page.route("**/api/open-editor", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false }) }),
    );
    // #30 — the tracking pixel host must never be hit. Count + block it.
    let trackerHits = 0;
    await page.route("**tracker.example**", (route) => {
      trackerHits++;
      return route.abort();
    });
    // #22/#23 — any sandbox escape would raise a dialog; fail if one fires.
    let dialogFired = false;
    page.on("dialog", (d) => {
      dialogFired = true;
      void d.dismiss();
    });
    const card = await spawnFreshGitSession(page);
    await card.click();

    // ── rich.eml: the everything fixture ──────────────────────────────────
    const rich = await openEml(page, "rich.eml");
    const frame = rich.getByTestId("eml-body-frame");

    // #22 — body iframe sandbox is EXACTLY "" (opaque origin, no allow-same-origin).
    await expect(frame).toHaveAttribute("sandbox", "");

    // #23 — the XSS subject is shown as literal escaped text (no element, no alert).
    await expect(rich.getByTestId("eml-preview")).toContainText("onerror=alert(1)");
    expect(dialogFired).toBe(false);

    // #24 — header starts collapsed; clicking it reveals from/to/date/subject.
    await expect(rich.getByTestId("eml-header-full")).toHaveCount(0);
    await rich.getByTestId("eml-header-toggle").click();
    const full = rich.getByTestId("eml-header-full");
    await expect(full).toBeVisible();
    await expect(full).toContainText("alice@example.com");
    await expect(full).toContainText("bob@example.com");

    // #32 — cid: refs (src AND CSS url()) resolve to blob: URLs before srcDoc build.
    await expect
      .poll(async () => (await frame.getAttribute("srcdoc")) ?? "", { timeout: 15_000 })
      .toContain("blob:");
    const srcdoc = (await frame.getAttribute("srcdoc")) ?? "";
    expect(srcdoc).not.toContain("cid:logo");

    // #30 — remote tracker image blocked on render; "Load remote content" shown.
    expect(trackerHits).toBe(0);
    const banner = rich.getByTestId("eml-load-remote");
    await expect(banner).toBeVisible();

    // #31 — activating the banner re-requests the body with ?allowRemote=1
    // (browser fetches remote content; the server never does). Arm the request
    // wait BEFORE the click to avoid a capture race.
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

    // #28 — the .docx row offers download only (no expand affordance).
    await expect(docxRow.getByTestId("eml-attachment-download")).toBeVisible();
    await expect(docxRow.getByTestId("eml-attachment-expand")).toHaveCount(0);

    // #26 — expanding the PDF row renders PdfPreview inline from a blob: URL
    // (the PdfPreview canvas mounts; the top-level URL does not navigate).
    const urlBefore = page.url();
    await pdfRow.getByTestId("eml-attachment-expand").click();
    await expect(pdfRow.locator("canvas")).toBeVisible({ timeout: 30_000 });
    expect(page.url()).toBe(urlBefore);

    // #27 — expanding the image row renders ImagePreview inline via a blob: URL.
    await jpgRow.getByTestId("eml-attachment-expand").click();
    await expect(jpgRow.locator('img[src^="blob:"]')).toBeVisible({ timeout: 20_000 });

    // #25 — inline card ⤢ expand mounts the SAME EmlPreview in the /view overlay.
    await rich.getByTestId("preview-expand").click();
    await expect(page).toHaveURL(/\/folder\/[^/]+\/view\?path=rich\.eml/, { timeout: 15_000 });
    await expect(page.getByTestId("eml-preview")).toBeVisible({ timeout: 20_000 });

    // ── lazy.eml: attachment bytes fetched only on expand ─────────────────
    let attachmentReqs = 0;
    await page.route("**/api/file/eml-attachment**", (route) => {
      if (route.request().url().includes("lazy.eml")) attachmentReqs++;
      return route.continue();
    });
    await page.goBack();
    const lazy = await openEml(page, "lazy.eml");
    // #29 — no attachment request has fired before any row is expanded.
    await expect(lazy.getByTestId("eml-preview")).toBeVisible();
    expect(attachmentReqs).toBe(0);
    await lazy.getByTestId("eml-attachment-expand").first().click();
    await expect.poll(() => attachmentReqs, { timeout: 20_000 }).toBeGreaterThan(0);
  });
});

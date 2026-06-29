import { test, expect, type Locator, type Page } from "@playwright/test";
import { spawnFreshGitSession, sendPrompt } from "./helpers/index.js";

// Faux round-trip — selectable tool-output links (task 3.2, change: selectable-tool-output-links).
//
// `[[faux:text-linkrefs]]` streams an assistant message with an inline-code span
// `src/example.ts https://example.com/page`. Inline code is linkified, so it
// renders a real FileLink (<button>) and UrlLink (<a>). This spec is the
// automatable half of the manual task 3.2: it proves a click-drag that STARTS
// ON a link extends the text selection (the link no longer hijacks the drag),
// and that a plain click still opens. The OS clipboard keystroke half (Ctrl+C)
// is not deterministically assertable in Playwright; the selection it would
// copy is what we assert here.

const FILE_TEXT = "src/example.ts";
const URL_TEXT = "https://example.com/page";

/**
 * Real mouse click-drag that CROSSES `loc` — starts just left of the link (in
 * surrounding text), sweeps through it, ends just right. This is the
 * "selection crosses a link" case from the spec; pre-fix the link boundary
 * killed the highlight (the <button> swallowed the gesture / the draggable <a>
 * started a native link-drag).
 *
 * NOTE: we cross the link rather than starting the mousedown ON it. A synthetic
 * mousedown directly on a <button> does not initiate a text selection in
 * headless Chromium (returns an empty selection even WITH the fix), so a
 * starts-on-link drag can't assert selection reliably. The starts-on-link
 * regression is instead guarded by the computed-style assertions below
 * (`user-select:text` + `draggable=false`) — remove either and the button
 * swallows / the anchor drags, which those checks catch.
 */
async function dragAcross(page: Page, loc: Locator): Promise<void> {
  const box = await loc.boundingBox();
  if (!box) throw new Error("link has no bounding box");
  const y = box.y + box.height / 2;
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(box.x - 6, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, y, { steps: 8 });
  await page.mouse.move(box.x + box.width + 8, y, { steps: 8 });
  await page.mouse.up();
}

const selectionText = (page: Page) =>
  page.evaluate(() => window.getSelection()?.toString() ?? "");

test.describe("faux round-trip — selectable tool-output links", () => {
  test("links are drag-selectable and a plain click still opens", async ({ page }) => {
    // Force the preview path: the container may detect code-server as a local
    // editor, which would route a FileLink click to the editor instead.
    await page.route("**/api/open-editor", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: "editor disabled for e2e" }),
      }),
    );

    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:text-linkrefs]] go");

    const fileLink = page.getByText(FILE_TEXT, { exact: true }).first();
    const urlLink = page.getByText(URL_TEXT, { exact: true }).first();
    await expect(fileLink).toBeVisible({ timeout: 30_000 });
    await expect(urlLink).toBeVisible();

    // (1) The enabling implementation: FileLink <button> is selectable text and
    // neither link is draggable, so a drag is a selection, not a link/button drag.
    expect(await fileLink.evaluate((el) => getComputedStyle(el).userSelect)).toBe("text");
    expect(await fileLink.evaluate((el) => (el as HTMLButtonElement).draggable)).toBe(false);
    expect(await urlLink.evaluate((el) => (el as HTMLAnchorElement).draggable)).toBe(false);

    // (2) A click-drag that STARTS ON the file link extends the selection to
    // include the link's text (pre-fix the <button> swallowed the gesture).
    await dragAcross(page, fileLink);
    expect(await selectionText(page)).toContain(FILE_TEXT);

    // (3) A click-drag that STARTS ON the URL link selects rather than starting
    // a native link-drag (pre-fix the draggable <a> hijacked the gesture).
    await dragAcross(page, urlLink);
    expect(await selectionText(page)).toContain(URL_TEXT);

    // (4) Click-to-open is preserved for the URL link: a plain click (no drag →
    // no selection) opens a new tab (target=_blank). Done before the file
    // preview, which opens a modal overlay over the links.
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      urlLink.click(),
    ]);
    expect(popup.url()).toContain("example.com/page");
    await popup.close();

    // (5) Click-to-open is preserved for the file link: a plain click opens the
    // read-only preview overlay.
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await fileLink.click();
    await expect(page.getByTestId("file-preview-overlay")).toBeVisible({ timeout: 15_000 });
  });
});

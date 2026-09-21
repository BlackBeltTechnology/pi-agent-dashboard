import { mdiCheck } from "@mdi/js";
import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Test-plan #X3 — insecure-origin end-to-end copy.
//
// `navigator.clipboard` only exists in a secure context (HTTPS or localhost).
// The dashboard's remote deployments are plain-http tunnels (zrok/ngrok), where
// the Clipboard API is unavailable and the old CopyButton silently did nothing.
// This spec reproduces that environment in-container by deleting
// `navigator.clipboard` before page scripts run, then drives the REAL pipeline
// → bridge → /ws → ChatView → MarkdownContent → CopyButton and asserts the ✓
// feedback appears — which can only happen if the hidden-textarea + execCommand
// fallback in `lib/util/clipboard.ts#copyText` ran and reported success.
//
// Origins are the only thing stubbed; the copy path, the message pipeline and
// the affordances are all production code. See change:
// fix-long-session-ux-degradation (D2).
test.describe("insecure origin — fallback-backed copy", () => {
  test("a copy affordance succeeds and shows ✓ with no Clipboard API", async ({ page }) => {
    // The zrok/ngrok shape: plain http → `navigator.clipboard` undefined.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        get: () => undefined,
      });
    });

    const card = await spawnFreshGitSession(page);
    await card.click();

    // Premise check: the page really is in the insecure-context shape, so a
    // passing assertion below cannot be the Clipboard API succeeding.
    expect(await page.evaluate(() => navigator.clipboard)).toBeUndefined();

    await sendPrompt(page, "[[faux:copy-surfaces]] go");
    // The code-block copy button mounts last (fence complete), so its visibility
    // proves the table before it has fully streamed.
    await expect(page.getByTitle("Copy code")).toBeVisible({ timeout: 30_000 });

    const copyBtn = page.getByTitle("Copy as TSV");
    await expect(copyBtn).toBeVisible();
    // Baseline textareas (the composer is one); the fallback must not ADD one.
    const textareasBefore = await page.locator("textarea").count();
    await copyBtn.click();

    // ✓ is the mdiCheck glyph; its appearance proves copyText returned true via
    // the fallback (the API path is absent).
    await expect(copyBtn.locator(`svg path[d="${mdiCheck}"]`)).toBeVisible({ timeout: 5_000 });

    // The fallback's hidden textarea must not leak into the document.
    expect(await page.locator("textarea").count()).toBe(textareasBefore);
  });
});

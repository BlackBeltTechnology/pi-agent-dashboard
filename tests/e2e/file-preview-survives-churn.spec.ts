import { expect, test } from "@playwright/test";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Rendered-DOM regression for change: fix-file-preview-survives-message-churn.
//
// The bug: the file-preview overlay's open-state lived at the leaf `FileLink`,
// inside the react-markdown subtree that rebuilds on every content change — so
// a new chat message, a streaming token, or a streaming→committed transition
// remounted `FileLink` and closed the overlay. The fix hoists that state into a
// `FilePreviewProvider` mounted above the message list in `ChatView`.
//
// This spec proves the fix end-to-end in a real browser (the jsdom RTL specs
// 4.1–4.3 assert the same invariant at unit level via forced remounts):
//   1. Open a preview on a REAL fixture file → overlay shows live content.
//   2. CHURN: push another assistant message that streams a long body (new
//      message + streaming reparses + streaming→committed transition).
//   3. The overlay stays open AND keeps its content throughout.
//   4. Explicit dismissal (Esc) still closes it.
//
// The container may detect code-server as a local editor, which would route a
// FileLink click to the editor instead of the preview overlay. We force the
// preview path by failing `/api/open-editor`, so `useFileOpenRouting` falls
// back to the overlay regardless of editor detection (mirrors
// tool-output-links.spec.ts).
test.describe("file preview survives message churn", () => {
  test("open preview, then stream a new message → overlay stays open with content", async ({
    page,
  }) => {
    await page.route("**/api/open-editor", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: "editor disabled for e2e" }),
      }),
    );

    const card = await spawnFreshGitSession(page);
    await card.click();

    // 1. Open a preview on a real file (`./hello.txt` in /fixtures/sample-git).
    await sendPrompt(page, "[[faux:text-realfile]] go");
    const link = page.getByText("./hello.txt", { exact: true }).first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    await link.click();

    const overlay = page.getByTestId("file-preview-overlay");
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    // Live content proves the read succeeded (not a stale-file error body).
    await expect(overlay).toContainText("hello from the sample-git fixture", {
      timeout: 15_000,
    });

    // 2. CHURN: a second prompt appends a user message and streams a long
    // assistant body — exercising every remount trigger the bug rode on
    // (new message, react-markdown reparse, streaming→committed transition).
    await sendPrompt(page, "[[faux:slow-stream]] go");

    // Streaming has begun: first chunk rendered in the message list.
    await expect(page.getByText("slow-chunk-0").first()).toBeVisible({
      timeout: 30_000,
    });
    // 3a. Overlay survives mid-stream churn, content intact.
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("hello from the sample-git fixture");

    // Stream completes → the message transitions from live to committed render.
    await expect(page.getByText("slow-chunk-39").first()).toBeVisible({
      timeout: 30_000,
    });
    // 3b. Overlay survives the streaming→committed transition too.
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("hello from the sample-git fixture");

    // 4. Regression: explicit dismissal still closes the overlay.
    await page.keyboard.press("Escape");
    await expect(overlay).toBeHidden({ timeout: 5_000 });
  });
});

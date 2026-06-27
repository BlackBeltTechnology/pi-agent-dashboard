import { test, expect } from "@playwright/test";
import { spawnFreshGitSession, sendPrompt } from "./helpers/index.js";

// Faux round-trip — tool-output file-link behaviour (change: selectable-tool-output-links).
//
// `[[faux:text-difflinks]]` streams an assistant message whose body is a unified-
// diff header: `diff --git a/src/ghost.ts b/src/ghost.ts`. ChatView renders it
// through MarkdownContent, which linkifies the `a/`/`b/` paths into FileLinks.
//
// This proves two things end-to-end in a real browser:
//   1. The tokenizer strips the synthetic `a/` diff prefix from the RESOLVED
//      path — clicking `a/src/ghost.ts` previews `src/ghost.ts`, not
//      `a/src/ghost.ts`.
//   2. `/api/file` 404s (ghost.ts does not exist in the fixture) and
//      FilePreviewOverlay renders the friendly "file no longer exists" message
//      keyed on the stripped path.
//
// The container may detect code-server as a local editor, which would route a
// FileLink click to the editor instead of the preview overlay. The test forces
// the preview path by failing `/api/open-editor`, so useFileOpenRouting falls
// back to the overlay regardless of editor detection.
test.describe("faux round-trip — tool-output file links", () => {
  test("git-diff a/ prefix is stripped and a stale link shows the no-longer-exists message", async ({
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

    await sendPrompt(page, "[[faux:text-difflinks]] go");

    // The diff header rendered: the a/-prefixed path is a clickable FileLink.
    const link = page.getByText("a/src/ghost.ts", { exact: true }).first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    await link.click();

    // Preview overlay opens (editor path forced off), keyed on the STRIPPED path.
    await expect(page.getByTestId("file-preview-overlay")).toBeVisible({ timeout: 15_000 });

    // /api/file 404 → friendly stale-file message referencing the stripped path.
    // "at src/ghost.ts" (not "at a/src/ghost.ts") proves the diff prefix was dropped.
    await expect(page.getByTestId("file-preview-error")).toContainText(
      /no longer exists at src\/ghost\.ts/i,
      { timeout: 15_000 },
    );
  });
});

import { expect, test } from "@playwright/test";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Faux round-trip — Phase-1 server-side tilde-home mention resolution
// (change: server-side-file-mention-resolution, test-plan S19).
//
// `[[faux:text-tildelink]]` streams an assistant message referencing
// `~/.pi/agent/settings.json` — a home file test-entrypoint seeds under
// PI_E2E_SEED. MarkdownContent linkifies the mention into ONE `~/…` FileLink
// (the new tilde tokenizer branch). Clicking it MUST resolve server-side
// (expand `~/`, authorize via the fixed `~/.pi` anchor) and open the resolved
// HOME file — NOT a `/`-rooted 404 from the old tilde-split defect.
//
// The tilde token is `absolute:true`, so the click always routes to the preview
// overlay (never the cwd-rooted split); the `/api/open-editor` stub mirrors the
// sibling tool-output-links spec to keep any editor detection out of the path.
test.describe("faux round-trip — tilde-home file mention resolves on click", () => {
  test("clicking a ~/.pi mention opens the resolved home file, not a /-rooted 404", async ({
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

    await sendPrompt(page, "[[faux:text-tildelink]] go");

    // The mention rendered as ONE clickable FileLink retaining the verbatim `~/…`.
    const link = page.getByText("~/.pi/agent/settings.json", { exact: true }).first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    await link.click();

    // Preview overlay opens (editor path forced off) …
    await expect(page.getByTestId("file-preview-overlay")).toBeVisible({ timeout: 15_000 });
    // … with real content (the seeded home file read succeeded) …
    await expect(page.getByTestId("file-preview-code")).toBeVisible({ timeout: 15_000 });
    // … and NOT a stale/404 error body (the old bug would 404 on a /-rooted split).
    await expect(page.getByTestId("file-preview-error")).toHaveCount(0);
  });
});

import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Faux round-trip — a `~/` file mention opens in the EDITOR PANE
// (changes: server-side-file-mention-resolution S19, rewritten by fix-file-link-editor-routing, test-plan #S53).
//
// `[[faux:text-tildelink]]` streams an assistant message referencing
// `~/.pi/agent/settings.json` — a home file test-entrypoint seeds under
// PI_E2E_SEED. MarkdownContent linkifies the mention into ONE `~/…` FileLink.
// Clicking it resolves server-side (expand `~/`, authorize via the fixed `~/.pi`
// anchor) and — the split workspace being live for the session — opens the
// resolved HOME file as an absolute-path tab in the editor pane. It no longer
// opens `file-preview-overlay` (that was the pre-change behaviour of absolute links).
//
// The `/api/open-editor` stub is kept (and counted) to prove the link never takes
// the external-editor path.
test.describe("faux round-trip — tilde-home file mention opens in the editor pane", () => {
  test("clicking a ~/.pi mention opens a pane tab for the resolved home file, not the overlay", async ({
    page,
  }) => {
    const openEditorRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/open-editor")) openEditorRequests.push(req.url());
    });
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

    // The editor pane opens with a tab for the resolved HOME file (absolute path,
    // NOT a `/`-rooted 404 from the old tilde-split defect) …
    await expect(page.getByTestId("split-editor-pane").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="editor-tab"][data-tab-path$="/.pi/agent/settings.json"]')).toHaveCount(1, {
      timeout: 15_000,
    });
    // … renders the file content (Monaco mounted for the JSON file) …
    await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
    // … with no denial / load-error notice …
    await expect(page.getByTestId("denial-notice")).toHaveCount(0);
    // … and the overlay count converges to 0, with no external-editor request.
    await expect(page.getByTestId("file-preview-overlay")).toHaveCount(0);
    expect(openEditorRequests).toEqual([]);
  });
});

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { expandMountedToolOutputs } from "./helpers/tool-expand.js";

// Rendered file-link behaviour (change: rich-chat-links; test-plan F7, F8, F9, F12; tasks 9.2, 9.3, 9.4, 9.7).
//
// Files are baked into docker/fixtures/sample-git (`packages/x/src/a.ts`, `mockups/board.html`,
// `rl-a/sub/memo.md`, `rl-b/sub/memo.md`); the scenarios live in qa/fixtures/faux-scenarios.ts (`rich-links-*`).

async function openSession(page: Page, scenario: string): Promise<void> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await sendPrompt(page, `[[faux:${scenario}]] go`);
  if (scenario === "rich-links-html") return; // assistant text: already rendered inline
  // Tool results are collapsed by default: once the run has finished, open the burst and its step.
  await expect(page.getByText(`${scenario.replace("rich-links-", "")} done`)).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(
      async () => {
        await expandMountedToolOutputs(page);
        return page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-testid="tool-call-step"]')).some((s) => s.children.length > 1),
        );
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

const stateLink = (page: Page, text: string, state?: string) =>
  page.locator(state ? `[data-link-state="${state}"]` : "[data-link-state]").filter({ hasText: text }).first();

test.describe("rich-chat-links — file links (rendered)", () => {
  test("F7: a dead link is visible without clicking; the existing one converges to found", async ({ page }) => {
    const openRequests: string[] = [];
    page.on("request", (req) => {
      if (/\/api\/(open-editor|file\b)/.test(req.url()) && !req.url().includes("resolve-mention")) {
        openRequests.push(req.url());
      }
    });
    await openSession(page, "rich-links-states");

    const missing = stateLink(page, "src/definitely-missing.ts", "missing");
    await expect(missing).toBeVisible({ timeout: 30_000 });
    await expect(missing).toHaveCSS("text-decoration-line", /line-through/);
    await expect(stateLink(page, "packages/x/src/a.ts", "found")).toBeVisible({ timeout: 15_000 });
    // No click was performed: nothing opened (no pane tab, no overlay, no file/editor request).
    await expect(page.locator('[data-testid="editor-tab"]')).toHaveCount(0);
    await expect(page.getByTestId("file-preview-overlay")).toHaveCount(0);
    expect(openRequests).toEqual([]);
  });

  test("F8: a link recovered from a subdirectory command opens the real file", async ({ page }) => {
    await openSession(page, "rich-links-subdir");

    // The command `cd`s into packages/x, so the link resolves through the tool's directory.
    const link = stateLink(page, "src/a.ts");
    await expect(link).toBeVisible({ timeout: 30_000 });
    await expect(link).toHaveAttribute("data-link-state", /^(found|recovered)$/);
    await expect(link).toHaveAttribute("title", /packages\/x\/src\/a\.ts/);
    await link.click();

    await expect(page.locator('[data-testid="editor-tab"][data-tab-path$="packages/x/src/a.ts"]')).toHaveCount(1, {
      timeout: 15_000,
    });
  });

  test("F9: the HTML chevron opens a Static tab, then a read-only Source tab", async ({ page }) => {
    await openSession(page, "rich-links-html");

    const link = stateLink(page, "mockups/board.html");
    await expect(link).toBeVisible({ timeout: 30_000 });
    const chevron = page.getByTestId("link-html-menu-trigger").first();
    await expect(chevron).toBeVisible({ timeout: 15_000 });

    await chevron.click();
    await page.getByTestId("link-html-mode-static").click();
    await expect(page.locator('[data-testid="editor-tab"][data-tab-path$="mockups/board.html"]')).toHaveCount(1, {
      timeout: 15_000,
    });
    // Static mode: the existing Scripts ⇄ Static toggle starts on Static.
    await expect(page.getByTestId("live-mode-static")).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });

    await chevron.click();
    await page.getByTestId("link-html-mode-source").click();
    await expect(page.locator('[data-testid="editor-tab"][data-tab-path^="source:"]')).toHaveCount(1, {
      timeout: 15_000,
    });
    // Source tab: Monaco with the HTML text, read-only; the static tab is still present.
    const monaco = page.locator(".monaco-editor").first();
    await expect(monaco).toBeVisible({ timeout: 30_000 });
    await expect(monaco).toContainText("Board mock", { timeout: 15_000 });
    // Read-only: typing into the editor changes nothing.
    await monaco.locator(".view-lines").click();
    await page.keyboard.type("EDIT_MARKER");
    await expect(monaco).not.toContainText("EDIT_MARKER");
    await expect(monaco).toContainText("Board mock");
    await expect(page.locator('[data-testid="editor-tab"][data-tab-path$="mockups/board.html"]')).toHaveCount(2);
  });

  test("F12: an ambiguous link opens a picker; choosing opens that file; Escape opens nothing", async ({ page }) => {
    await openSession(page, "rich-links-picker");

    const link = stateLink(page, "sub/memo.md", "ambiguous");
    await expect(link).toBeVisible({ timeout: 30_000 });

    // Escape: the picker lists both candidates and nothing opens.
    await link.click();
    const picker = page.getByRole("dialog");
    const options = picker.getByRole("option");
    await expect(options).toHaveCount(2, { timeout: 15_000 });
    await expect(options.nth(0)).toContainText("rl-a/sub/memo.md");
    await expect(options.nth(1)).toContainText("rl-b/sub/memo.md");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator('[data-testid="editor-tab"]')).toHaveCount(0);

    // Choose the second entry: that file opens.
    await link.click();
    await expect(page.getByRole("option")).toHaveCount(2, { timeout: 15_000 });
    await page.getByRole("option").nth(1).click();
    await expect(page.locator('[data-testid="editor-tab"][data-tab-path$="rl-b/sub/memo.md"]')).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(page.locator('[data-testid="editor-tab"][data-tab-path$="rl-a/sub/memo.md"]')).toHaveCount(0);
  });
});

import { expect, type Page, test } from "@playwright/test";
import { spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — terminals as tabs inside the editor pane
// (change: terminals-in-tabbed-panes).
//
// Proves the session-split "+ Terminal" affordance (`new-terminal-launch` in
// the EditorPane header) creates a terminal, opens it as a `term:<id>` tab
// beside file tabs, and mounts a live xterm over `/ws/terminal/:id`. xterm.js
// renders a hidden textarea labelled "Terminal input" — its presence proves the
// pane initialized end-to-end (same signal the inline-terminal spec uses).
//
// Folder-pane auto-surface (D3) and stale-tab reconcile-on-load (D5) are
// deterministic decision logic covered at L1 by
// packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts — the L3
// paths need cross-cwd terminal seeding + reload timing that is harness-flaky,
// so (per the editor-pane.spec F9/F11 precedent) they stay at L1.

async function dismissToasts(page: Page): Promise<void> {
  for (const btn of await page.getByRole("button", { name: "Dismiss" }).all()) {
    await btn.click().catch(() => {});
  }
}

/** Click a testid, dismissing overlapping spawn toasts and retrying until it lands. */
async function robustClick(page: Page, testid: string): Promise<void> {
  const target = page.getByTestId(testid);
  await expect(async () => {
    await dismissToasts(page);
    await target.click({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

test.describe("terminal tabs in the editor pane", () => {
  test("+ Terminal in the split creates a terminal tab; xterm mounts; close removes it", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    // Open the split so the EditorPane (with the + Terminal control) mounts.
    await page.getByTestId("layout-mode-switch").waitFor({ state: "visible", timeout: 30_000 });
    await robustClick(page, "layout-mode-split");
    await expect(page.getByTestId("split-editor-pane")).toBeVisible();

    // No terminal tab surfaces in the split until the user asks (D3 opt-in).
    const editorPane = page.getByTestId("split-editor-pane");
    await expect(editorPane.getByRole("tab")).toHaveCount(0);

    // + Terminal → creates a terminal at the session cwd and opens its tab.
    await robustClick(page, "new-terminal-launch");

    // A tab appears in the pane tab strip (labelled by the shell/title, e.g.
    // "bash") and the live xterm mounts — the hidden textarea labelled
    // "Terminal input" proves the term:<id> viewer initialized over the WS.
    await expect(
      page.getByRole("textbox", { name: /terminal input/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(editorPane.getByRole("tab")).toHaveCount(1);

    // Closing the terminal tab kills the terminal and drops the tab (D4).
    const termTab = editorPane.getByRole("tab").first();
    await termTab.hover();
    await termTab.getByRole("button").first().click();
    await expect(editorPane.getByRole("tab")).toHaveCount(0, { timeout: 20_000 });
  });
});

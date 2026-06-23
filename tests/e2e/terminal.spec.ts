import { test, expect } from "@playwright/test";
import { byTestId, ensureGitSession } from "./helpers/index.js";

// Scenario 5.4 — inline terminal mounts a live xterm.
//
// `open-inline-terminal-button` lives in the SELECTED session's composer
// (CommandInput). Clicking it mounts an `InlineTerminalCard` in the chat
// stream; that renders a `TerminalView` which calls `terminal.open(div)` and
// opens a WebSocket to `/ws/terminal/:id`. xterm.js renders a hidden input
// textarea with aria-label "Terminal input" — its presence proves the xterm
// pane mounted and initialized end-to-end. See change: add-e2e-spawn-scenarios.
test.describe("inline terminal", () => {
  test("open inline terminal, xterm mounts", async ({ page }) => {
    const card = await ensureGitSession(page);

    // Select the session so its composer (CommandInput) renders.
    await card.click();

    const openBtn = byTestId(page, "openInlineTerminalButton");
    await expect(openBtn).toBeVisible({ timeout: 15_000 });
    await openBtn.click();

    // xterm mounts a hidden textarea labelled "Terminal input" — its presence
    // proves the inline terminal pane initialized over the terminal WS.
    await expect(
      page.getByRole("textbox", { name: /terminal input/i }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});

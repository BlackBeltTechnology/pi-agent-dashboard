import { test, expect } from "@playwright/test";
import { spawnFreshGitSession, sendPrompt } from "./helpers/index.js";

// Faux round-trip — interactive ask_user renderer.
//
// Sends `[[faux:ask-select]]`; the faux fixture streams an `ask_user` tool call
// (method `select`, options ["alpha","beta"]). The bridge surfaces it as an
// interactiveUi message → /ws → ChatView dispatches to SelectRenderer, which
// renders one clickable option button per choice. Asserting the "alpha" option
// button is visible proves the interactive select widget mounted end-to-end.
//
// Scenario args: qa/fixtures/faux-scenarios.ts → askScenario("select", { options }).

test.describe("faux round-trip — interactive ask_user", () => {
  test("select widget mounts for a faux ask_user tool call", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:ask-select]] go");

    await expect(
      page.getByRole("button", { name: /alpha/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});

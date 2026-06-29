import { test, expect } from "@playwright/test";
import { spawnFreshGitSession, sendPrompt } from "./helpers/index.js";

// Faux round-trip — tool-call renderer.
//
// Sends `[[faux:tool-read]]`; the faux fixture streams a `read` tool call
// (path `src/example.ts`). The bridge forwards the toolcall_* events → /ws →
// ChatView dispatches to ReadToolRenderer, which renders the file path in a
// mono span. Asserting the path is visible proves a faux tool call streamed and
// the read tool renderer mounted end-to-end.
//
// Scenario args: qa/fixtures/faux-scenarios.ts → toolScenario("read", { path }).
const READ_PATH = "src/example.ts";

test.describe("faux round-trip — tool call", () => {
  test("read tool renderer mounts for a faux tool call", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:tool-read]] go");

    await expect(page.getByText(READ_PATH).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});

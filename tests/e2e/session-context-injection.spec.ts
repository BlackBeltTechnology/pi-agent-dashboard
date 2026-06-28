import { expect, test } from "@playwright/test";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// End-to-end proof of the dashboard session-context injector.
//
// The bridge registers a `before_agent_start` handler that splice-replaces the
// trailing `Current working directory:` line of the system prompt with a
// dashboard fragment (delimiter + `You are pi session <id> running in <cwd>.`).
// The `[[faux:echo-system-context]]` scenario (qa/fixtures/faux-scenarios.ts)
// reads `context.systemPrompt` inside the faux provider and streams the
// fragment back as assistant text. So a verbatim match in the rendered DOM
// proves the injected fragment travelled: bridge → pi pipeline → provider →
// bridge → /ws → ChatView, with NO LLM credential.
//
// Asserts the always-on path (no attach needed). The attached-change line and
// the server→bridge attach/replay protocol are covered deterministically by
// unit + server integration tests. See change: inject-session-context-into-agent.

test.describe("dashboard session-context injection", () => {
  test("before_agent_start fragment reaches the model and renders", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:echo-system-context]] go");

    // Delimiter proves the fragment (not the NO_DASHBOARD_CONTEXT sentinel) was
    // present in the system prompt the provider received.
    await expect(page.getByText("pi-dashboard session context").first()).toBeVisible({
      timeout: 30_000,
    });
    // Always-on identity line.
    await expect(page.getByText(/You are pi session/).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});

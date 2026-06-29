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
  test("before_agent_start fragment reaches the model every turn, session-specific", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();
    await card.click();

    // Turn 1.
    await sendPrompt(page, "[[faux:echo-system-context]] one");
    // Delimiter proves the fragment (not the NO_DASHBOARD_CONTEXT sentinel) was
    // present in the system prompt the provider received.
    await expect(page.getByText("pi-dashboard session context").first()).toBeVisible({
      timeout: 30_000,
    });
    // Session-SPECIFIC: the echoed identity line carries this session's real id
    // and cwd — not a static placeholder. Backticks render as separate nodes, so
    // match the id/cwd substrings rather than the whole line.
    await expect(page.getByText(sessionId as string).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("/fixtures/sample-git").first()).toBeVisible({ timeout: 30_000 });

    // Turn 2 — proves the injection is per-turn, not first-turn-only. Count the
    // delimiter occurrences before/after so a regression that drops it on turn 2
    // fails here.
    const delimiter = page.getByText("pi-dashboard session context");
    const before = await delimiter.count();
    await sendPrompt(page, "[[faux:echo-system-context]] two");
    await expect.poll(() => delimiter.count(), { timeout: 30_000 }).toBeGreaterThan(before);
  });
});

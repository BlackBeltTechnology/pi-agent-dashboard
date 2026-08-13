import { test, expect } from "./fixtures.js";
import { spawnFreshGitSession, sendPrompt } from "./helpers/index.js";

// Faux round-trip — plain assistant text.
//
// Sends a `[[faux:plain-text]]` sentinel prompt through the composer; the faux
// fixture (staged by PI_E2E_SEED) resolves the `plain-text` scenario and streams
// PLAIN_TEXT_MARKER through pi's normal pipeline → bridge → /ws → ChatView. This
// proves the prompt → faux model → streamed events → rendered DOM round-trip
// with NO LLM credential. The marker is asserted verbatim (the visible
// `[[faux:…]]` sentinel in the user bubble is inert — never the assertion).
//
// Source of truth for the marker: qa/fixtures/faux-scenarios.ts (PLAIN_TEXT_MARKER).
const PLAIN_TEXT_MARKER = "The quick brown faux jumps over the lazy dog.";

test.describe("faux round-trip — plain text", () => {
  test("scripted assistant text renders in the message DOM", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:plain-text]] go");

    // The ACK settles the optimistic card, not the 30s safety timeout: assert
    // inside a window far below `TIMEOUT_MS`, and that the failed arm never
    // appears. See change: fix-optimistic-prompt-stuck-sending, test-plan #F1.
    // NOT asserted: the transient `sent` tick. The user `message_start` clears
    // the bubble entirely, and against the faux model that can land in the same
    // frame as the ack — asserting the tick would be racy. The composer gate is
    // the stable ack-settlement observable: it re-enables ONLY when the prompt
    // is no longer `sending`.
    await expect(page.getByTestId("pending-prompt-failed")).toHaveCount(0);
    await expect(page.getByPlaceholder(/message/i).first()).toBeEnabled({
      timeout: 15_000,
    });

    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("pending-prompt-failed")).toHaveCount(0);
  });
});

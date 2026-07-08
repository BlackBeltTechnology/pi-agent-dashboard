import { test, expect } from "@playwright/test";
import { spawnFreshGitSession, sendPrompt } from "./helpers/index.js";

/**
 * Error-lifecycle surface — deferred clear + single red surface (browser E2E).
 *
 * Validates change `unify-error-retry-lifecycle` end-to-end through the real
 * pipeline (faux model → bridge → /ws → reducer → SessionBanner), no LLM
 * credential:
 *
 *  1. A terminal model error surfaces ONE composed error-lifecycle surface
 *     (`error-banner`) with Retry + Dismiss, and NO yellow retry banner for a
 *     non-retryable error (single red surface).
 *  2. The error anchor PERSISTS across the start of a NEW turn that has not yet
 *     produced a confirmed-good response — it is NOT cleared optimistically on
 *     `agent_start`. Driven deterministically with an `ask_user` turn: it pauses
 *     at a `tool_use` stop (renders a stable "alpha" option, never auto-
 *     completes), so the prior error banner stays visible while the new turn is
 *     in flight.
 *  3. The error anchor clears ONLY on a confirmed-good response: a successful
 *     follow-up turn (`plain-text`, ending in `end_turn`) hides the banner.
 *
 * The pre-change behavior (optimistic clear on `agent_start`) would have hidden
 * the banner the instant the ask_user turn started, so test (2) is a true
 * discriminator. Faux scenarios: qa/fixtures/faux-scenarios.ts (model-error,
 * ask-select, plain-text). Requires PI_E2E_SEED=1 (faux model staged).
 */

const ERROR_MESSAGE = "faux model error";
// Marker the plain-text scenario streams (qa/fixtures/faux-scenarios.ts).
const PLAIN_TEXT_MARKER = "The quick brown faux jumps over the lazy dog.";

test.describe("error-lifecycle surface", () => {
  test("terminal error shows one error banner with Retry + Dismiss, no yellow", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:model-error]] go");

    const banner = page.getByTestId("error-banner");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("error-banner-text")).toContainText(ERROR_MESSAGE);

    // Exactly one red surface — never two banners for the same failure.
    await expect(page.getByTestId("error-banner")).toHaveCount(1);
    // Generic (non-billing) error → Retry + Dismiss available.
    await expect(page.getByTestId("error-banner-retry")).toBeVisible();
    await expect(page.getByTestId("error-banner-dismiss")).toBeVisible();
    // Non-retryable error → NO amber retry banner alongside the red one.
    await expect(page.getByTestId("retry-banner")).toHaveCount(0);
  });

  test("error anchor persists across a new turn that has no confirmed-good response yet", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    // 1. Terminal error → error anchor appears.
    await sendPrompt(page, "[[faux:model-error]] go");
    const banner = page.getByTestId("error-banner");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("error-banner-text")).toContainText(ERROR_MESSAGE);

    // 2. Start a NEW turn that PAUSES at an ask_user tool call (tool_use stop,
    //    never auto-completes) → agent_start fires but no confirmed-good
    //    response arrives.
    await sendPrompt(page, "[[faux:ask-select]] go");
    await expect(page.getByRole("button", { name: /alpha/i }).first()).toBeVisible({
      timeout: 30_000,
    });

    // 3. The error anchor MUST still be visible — it is NOT cleared on
    //    `agent_start` nor on the mid-turn `tool_use` stop. (Pre-change: the
    //    optimistic clear would have hidden it the instant this turn started.)
    await expect(banner).toBeVisible();
  });

  test("error anchor clears after a confirmed-good response", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    // 1. Terminal error → error anchor appears.
    await sendPrompt(page, "[[faux:model-error]] go");
    const banner = page.getByTestId("error-banner");
    await expect(banner).toBeVisible({ timeout: 30_000 });

    // 2. A successful follow-up turn (ends in end_turn = confirmed-good).
    await sendPrompt(page, "[[faux:plain-text]] go");
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({
      timeout: 30_000,
    });

    // 3. Only NOW does the error-lifecycle surface clear.
    await expect(banner).toBeHidden({ timeout: 15_000 });
  });
});

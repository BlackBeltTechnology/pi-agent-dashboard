import { expect, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — bridge inbound bash bound (B21), rendered end to end.
//
// The real bridge allows `PI_DASHBOARD_BRIDGE_MAX_BASH` (default 4) concurrent
// `!`/`!!` commands per session. Fill every slot with a slow `!!` command, send
// one more: it must be REFUSED VISIBLY (inline error naming the concurrency
// limit, optimistic bubble settled) instead of spawning or vanishing. After the
// slow commands finish, a new command runs and renders its output.
//
// `!!` (silent bash) is used throughout: it never sends to the LLM, so the spec
// needs no model credential and the session stays idle.
//
// Covers test-plan #BF2 (with the default limit rather than a harness override:
// the limit is an env on the bridge process, and the default needs no compose
// change). See change: harden-bridge-inbound-and-discovery.

const DEFAULT_MAX_BASH = 4;
const SLOW_SECONDS = 9;

test.describe("bridge inbound bash bound", () => {
  test("#BF2 a command over the concurrency limit is refused inline; the next one runs after a slot frees", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    // Fill every slot.
    for (let i = 0; i < DEFAULT_MAX_BASH; i++) {
      await sendPrompt(page, `!!sleep ${SLOW_SECONDS}; echo slot-${i}-done`);
    }

    // One more while all slots are busy.
    await sendPrompt(page, "!!echo refused-over-limit");

    // The refusal is visible inline and names the limit.
    await expect(page.getByText(/bash concurrency limit reached/i).first()).toBeVisible({ timeout: 15_000 });

    // Settled, not stuck: no pending bubble remains.
    await expect(byTestId(page, "pendingPromptCard")).toHaveCount(0, { timeout: 15_000 });

    // After the slow commands finish a slot is free again and the command runs.
    await expect(page.getByText(/slot-0-done/).first()).toBeVisible({ timeout: (SLOW_SECONDS + 20) * 1000 });
    await sendPrompt(page, "!!printf 'after-%s' limit");
    await expect(page.getByText(/after-limit/).first()).toBeVisible({ timeout: 30_000 });
  });
});

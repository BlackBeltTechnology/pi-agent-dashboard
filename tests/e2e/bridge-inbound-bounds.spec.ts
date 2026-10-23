import { expect, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — the bridge's bash-concurrency bound (B21) must never get in the
// way of legitimate traffic, rendered end to end.
//
// Why this is a regression guard and not a refusal scenario: the bridge drains
// one connection's inbound messages strictly in order (`ConnectionManager
// .drainInbound` awaits each handler), so `!`/`!!` commands from ONE UI session
// run one at a time — the per-session limit (`PI_DASHBOARD_BRIDGE_MAX_BASH`,
// default 4) is a backstop for overlapping work (an in-flight command of a
// previous incarnation across `/reload`), which a browser cannot arrange
// deterministically. The refusal itself (message, no spawn, slot release, bubble
// settled) is covered at L1/L2 (BE10–BE12) and by the reducer test (BF1).
//
// Here: fire MORE commands than the limit back to back. Every one must run and
// render its output — none refused, no stuck pending bubble — and a late command
// still runs. `!!` never reaches the LLM, so no model credential is needed.
//
// Covers test-plan #BF2 (re-scoped; see tasks.md 2.24).
// See change: harden-bridge-inbound-and-discovery.

const DEFAULT_MAX_BASH = 4;
const COMMANDS = DEFAULT_MAX_BASH + 2;

test.describe("bridge inbound bash bound", () => {
  test("#BF2 more back-to-back commands than the limit all run; none is refused", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    for (let i = 0; i < COMMANDS; i++) {
      // printf with a %s arg: the output `burst-N-done` is NOT a substring of the command text,
      // so the assertion below can only be satisfied by the rendered bash_output.
      await sendPrompt(page, `!!sleep 1; printf 'burst-%s-done' ${i}`);
    }

    // Every command ran, in order, and rendered.
    for (let i = 0; i < COMMANDS; i++) {
      await expect(page.getByText(`burst-${i}-done`).first()).toBeVisible({ timeout: 60_000 });
    }

    // Never refused.
    await expect(page.getByText(/bash concurrency limit reached/i)).toHaveCount(0);

    // Settled, not stuck.
    await expect(byTestId(page, "pendingPromptCard")).toHaveCount(0, { timeout: 15_000 });

    // A late command still runs.
    await sendPrompt(page, "!!printf 'after-%s' limit");
    await expect(page.getByText(/after-limit/).first()).toBeVisible({ timeout: 30_000 });
  });
});

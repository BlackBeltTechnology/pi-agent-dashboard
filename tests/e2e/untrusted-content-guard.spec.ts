import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// L3 — untrusted-content guard under the dashboard (test-plan #F1).
//
// `[[faux:guard-confirm]]` calls the `stub_fetch` fixture tool, whose result
// self-declares `details.untrusted` and carries one hidden span, then calls
// `bash`. The guard (staged by docker/test-entrypoint.sh) must:
//   1. strip the hidden span and append the findings summary to the result;
//   2. taint the run, so the bash call raises `ctx.ui.confirm` — served by the
//      dashboard PromptBus as a ConfirmRenderer card;
//   3. let bash run once the user approves.
//
// See change: add-untrusted-content-guard.

const CONFIRM_TITLE = "Untrusted content guard";
const SUMMARY = "[guard] 1 hidden span removed";
// The command is `echo guard-$((40+2))`, so only a real execution prints this.
const BASH_OUTPUT = "guard-42";

test.describe("untrusted-content guard — confirm under the dashboard", () => {
  test("#F1 a tainted run asks before bash; approving runs it", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:guard-confirm]] go");

    // The guard's confirm card, naming the tool and why it asks.
    await expect(page.getByText(CONFIRM_TITLE).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Untrusted content was read this run \(from stub_fetch\)/).first()).toBeVisible();
    // bash has not run while the prompt is pending.
    await expect(page.getByText(BASH_OUTPUT, { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: /^yes$/i }).first().click();

    await expect(page.getByText("guard scenario done").first()).toBeVisible({ timeout: 30_000 });
    // Settled tool calls fold into one group row, each card collapsed; open all three.
    await page.getByRole("button", { name: /2 tool calls/ }).first().click();
    await page.getByRole("button", { name: /^stub_fetch/ }).first().click();
    await page.getByRole("button", { name: /echo guard-/ }).first().click();
    await expect(page.getByText(BASH_OUTPUT).first()).toBeVisible({ timeout: 15_000 });

    // The stub_fetch result was cleaned and summarised: the payload never renders.
    await expect(page.getByText(SUMMARY, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/ignore previous instructions/)).toHaveCount(0);
  });
});

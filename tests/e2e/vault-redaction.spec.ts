/**
 * E2E: vault delivery + redaction against a real pi session (change:
 * add-credential-vault, test-plan F3, X13).
 *
 * The binding is `VAULT_E2E_API_KEY` (the harness image already sets `GEMINI_API_KEY` in every
 * process env, so that name would be a local-override).
 *
 * X13  A real bash env picks the grant up live: a child process reads
 *      `VAULT_E2E_API_KEY` → `undefined` before the grant, length `10` within 5 s after.
 * F3   `printenv VAULT_E2E_API_KEY` renders `[REDACTED:VAULT_E2E_API_KEY]`, and the DOM
 *      never contains the value, sampled on EVERY mutation.
 */

import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { OperatorSession } from "./helpers/operator-session.js";
import { SAMPLE_GIT_SUBJECT, VaultSeed } from "./helpers/vault-seed.js";

const op = new OperatorSession();
let seed: VaultSeed;
const VALUE = "abcdefgh12"; // 10 characters

/**
 * Bash rows render collapsed behind two disclosure levels ("$ <command>" group, then
 * its inner row). Open the newest until `expected` is visible.
 */
async function openLastBashRow(page: import("@playwright/test").Page, commandStart: string, expected: string): Promise<void> {
  const rows = page.getByText(new RegExp(`^\\$ ${commandStart}`));
  await rows.last().waitFor({ state: "visible", timeout: 60_000 });
  const target = page.getByText(expected).first();
  for (let level = 0; level < 3; level++) {
    if (await target.isVisible()) return;
    await rows.last().click();
    await page.waitForTimeout(500);
  }
}

test.describe("credential vault — delivery and redaction", () => {
  test.beforeEach(async ({ request, context }) => {
    await op.arm(request, context);
    seed = new VaultSeed(request, () => op.headers());
    await seed.reset();
  });
  // Restore per TEST, not per file: a timed-out test must not leave the harness's
  // trust seed narrowed for every spec that runs after it.
  test.afterEach(async ({ request }) => {
    await seed.reset();
    await op.restore(request);
  });

  test("X13 + F3 — delivered live to a real bash env, and redacted wherever it is shown", async ({ page, request }) => {
    // Sample every DOM mutation for the raw value from the very first paint.
    await page.addInitScript((value) => {
      (window as unknown as { __vaultLeak: boolean }).__vaultLeak = false;
      const check = () => {
        if (document.body?.textContent?.includes(value)) (window as unknown as { __vaultLeak: boolean }).__vaultLeak = true;
      };
      new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true });
    }, VALUE);

    const id = await seed.addAccount("gemini", "g", VALUE);
    await seed.addBinding("VAULT_E2E_API_KEY", id);

    const card = await spawnFreshGitSession(page);
    await card.click();

    // Before the grant the child sees nothing.
    await sendPrompt(page, "[[faux:vault-env-length]] go");
    await openLastBashRow(page, "echo", "LEN=undefined");
    await expect(page.getByText("LEN=undefined").first()).toBeVisible({ timeout: 60_000 });

    // Grant; once the hub has pushed it (well inside the 5 s budget), the next
    // command, a NEW child process, sees the value in the live bash env.
    const sessionId = (await card.getAttribute("data-session-id")) ?? "";
    await seed.grant(SAMPLE_GIT_SUBJECT, "VAULT_E2E_API_KEY");
    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/session/${sessionId}/vault-bindings`, { headers: op.headers() });
          const body = (await res.json().catch(() => ({}))) as { data?: { bindings: Array<{ state: string }> } };
          return body.data?.bindings[0]?.state;
        },
        { timeout: 5_000, intervals: [250] },
      )
      .toBe("delivered");
    await sendPrompt(page, "[[faux:vault-env-length]] go");
    await expect(page.getByText("env length done")).toHaveCount(2, { timeout: 60_000 });
    await openLastBashRow(page, "echo", "LEN=10");
    await expect(page.getByText("LEN=10").first()).toBeVisible({ timeout: 30_000 });

    // F3: the value itself is masked in the chat and never touches the DOM.
    await sendPrompt(page, "[[faux:vault-printenv]] go");
    await expect(page.getByText("printenv done").first()).toBeVisible({ timeout: 60_000 });
    await openLastBashRow(page, "printenv", "[REDACTED:VAULT_E2E_API_KEY]");
    await expect(page.getByText("[REDACTED:VAULT_E2E_API_KEY]").first()).toBeVisible({ timeout: 30_000 });
    expect((await page.locator("body").textContent()) ?? "").not.toContain(VALUE);
    expect(await page.evaluate(() => (window as unknown as { __vaultLeak: boolean }).__vaultLeak)).toBe(false);
  });
});

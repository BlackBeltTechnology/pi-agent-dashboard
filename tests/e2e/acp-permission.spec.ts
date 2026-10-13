import { expect, test } from "./fixtures.js";
import { spawnAcpSession } from "./helpers/acp.js";
import { sendPrompt } from "./helpers/index.js";

/**
 * ACP permission request surfaces as a select prompt and the answer resumes
 * the turn (test-plan #F3). The fake agent `qmt-perm` asks to run `npm test`.
 *
 * See change: add-acp-session-driver (task 7.53).
 */
test("an ACP permission request renders a prompt and Allow resumes the turn", async ({ page }) => {
  await spawnAcpSession(page, "qmt-perm");
  await sendPrompt(page, "run the tests");

  const allow = page.getByRole("button", { name: /allow once/i }).first();
  await expect(allow).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^deny$/i }).first()).toBeVisible();
  await allow.click();

  await expect(allow).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText("Run npm test").first()).toBeVisible();
});

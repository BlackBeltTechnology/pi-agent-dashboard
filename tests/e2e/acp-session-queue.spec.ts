import { expect, test } from "./fixtures.js";
import { spawnAcpSession } from "./helpers/acp.js";
import { byTestId, sendPrompt } from "./helpers/index.js";

/**
 * A prompt sent while an ACP turn is running is queued (chip), then runs when
 * the turn ends (test-plan #F2). `qmt-slow` delays every scripted step.
 *
 * See change: add-acp-session-driver (task 7.52).
 */
test("a mid-turn prompt on an ACP session shows in the queue and then runs", async ({ page }) => {
  await spawnAcpSession(page, "qmt-slow");
  await sendPrompt(page, "first prompt");
  await expect(page.getByText("first prompt").first()).toBeVisible({ timeout: 30_000 });

  // Mid-turn the composer offers Enter (the send button becomes Stop).
  const composer = page.getByPlaceholder(/message/i).first();
  await composer.fill("queued prompt");
  await composer.press("Enter");
  await expect(byTestId(page, "queueChipFollowup").first()).toContainText("queued prompt", { timeout: 15_000 });
  await expect(byTestId(page, "queueChipFollowup")).toHaveCount(0, { timeout: 60_000 });
});

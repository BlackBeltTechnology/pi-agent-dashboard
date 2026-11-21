import { expect, test } from "./fixtures.js";
import { spawnAcpSession } from "./helpers/acp.js";
import { byTestId, expandQueueLane, sendPrompt } from "./helpers/index.js";

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
  await expandQueueLane(page); // the chip lives in the dock's Queue lane body
  await expect(byTestId(page, "queueChipFollowup").first()).toContainText("queued prompt", { timeout: 15_000 });
  await expect(byTestId(page, "queueChipFollowup")).toHaveCount(0, { timeout: 60_000 });
});

/**
 * A REST steer on an ACP session has no steering primitive: it queues as a
 * follow-up, exactly like a browser steer there (test-plan #X3).
 * See change: add-rest-prompt-delivery-mode.
 */
test("a REST steer on an ACP session queues as a follow-up and runs after the turn", async ({ page }) => {
  const card = await spawnAcpSession(page, "qmt-slow");
  const sessionId = (await card.getAttribute("data-session-id")) ?? "";
  await sendPrompt(page, "first prompt");
  await expect(page.getByText("first prompt").first()).toBeVisible({ timeout: 30_000 });
  const res = await page.request.post(`/api/session/${sessionId}/prompt`, {
    data: { text: "rest steer on acp", delivery: "steer" },
  });
  expect(res.ok()).toBeTruthy();
  await expandQueueLane(page);
  await expect(byTestId(page, "queueChipFollowup").first()).toContainText("rest steer on acp", { timeout: 15_000 });
  await expect(byTestId(page, "queueChipFollowup")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText("rest steer on acp").first()).toBeVisible({ timeout: 60_000 });
});

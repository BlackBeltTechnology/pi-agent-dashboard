import { expect, test } from "@playwright/test";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// End-to-end proof of the reasoning auto-collapse timer (change:
// reasoning-auto-collapse-timer). The faux `thinking-text` scenario streams a
// `fauxThinking(...)` block through pi's LIVE event path (bridge → /ws →
// ChatView `case "event"`), which stamps `streamedLive:true` on the committed
// `role:"thinking"` message. That committed block mounts EXPANDED and arms its
// own auto-collapse timer; a replayed (reloaded) block carries `streamedLive`
// falsy and renders collapsed with no timer.
//
// Preconditions driven per-test via REST:
//   PATCH /api/preferences/display { reasoning: true, reasoningAutoCollapseMs }
// The persisted block only renders when `reasoning:true`; the 30s product
// default is shrunk to keep the collapse observable inside the test budget.
//
// Marker text comes from qa/fixtures/faux-scenarios.ts ("thinking-text").
const THINKING_TEXT = "faux is thinking about the prompt";
const DONE_TEXT = "done thinking";

async function patchDisplayPrefs(
  page: import("@playwright/test").Page,
  prefs: { reasoning: boolean; reasoningAutoCollapseMs: number },
): Promise<void> {
  const res = await page.request.patch("/api/preferences/display", { data: prefs });
  expect(res.ok()).toBeTruthy();
}

test.describe("reasoning auto-collapse timer", () => {
  test("live reasoning holds open then auto-collapses; reload renders it collapsed", async ({ page }) => {
    await patchDisplayPrefs(page, { reasoning: true, reasoningAutoCollapseMs: 1500 });

    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();
    await card.click();

    await sendPrompt(page, "[[faux:thinking-text]] go");

    // Turn completes → the committed reasoning block is present and, because it
    // was streamed live, mounted EXPANDED: its body text is visible.
    await expect(page.getByText(DONE_TEXT).first()).toBeVisible({ timeout: 30_000 });
    const body = page.getByTestId("reasoning-body");
    await expect(body.getByText(THINKING_TEXT)).toBeVisible();

    // After the 1.5s hold window the block auto-collapses (body removed).
    await expect(page.getByTestId("reasoning-body")).toHaveCount(0, { timeout: 6_000 });
    // The collapsed header remains.
    await expect(page.getByTestId("reasoning-block").last()).toBeVisible();

    // Reload → the block arrives via the REPLAY path (streamedLive falsy) and
    // renders collapsed immediately, with no flash-open.
    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
    await page.locator(`[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`).click();
    await expect(page.getByText(DONE_TEXT).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("reasoning-block").last()).toBeVisible();
    await expect(page.getByTestId("reasoning-body")).toHaveCount(0);
  });

  test("reasoningAutoCollapseMs=0 keeps a live block open indefinitely", async ({ page }) => {
    await patchDisplayPrefs(page, { reasoning: true, reasoningAutoCollapseMs: 0 });

    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:thinking-text]] go");

    await expect(page.getByText(DONE_TEXT).first()).toBeVisible({ timeout: 30_000 });
    const body = page.getByTestId("reasoning-body");
    await expect(body.getByText(THINKING_TEXT)).toBeVisible();

    // No timer is ever armed: the block stays open well past any window.
    await page.waitForTimeout(2_500);
    await expect(page.getByTestId("reasoning-body").getByText(THINKING_TEXT)).toBeVisible();
  });
});

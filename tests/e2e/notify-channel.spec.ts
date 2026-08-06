import { expect, test } from "@playwright/test";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Rendered-UI behaviour for the split notify channel (browser E2E).
 *
 * A notification is transcript history, not an unanswered ask. The regression
 * this change fixes is only visible AT REST — a notify used to leave the card
 * reading "Needs you" forever — so the assertions read the quiescent card, not
 * the mid-turn one.
 *
 * Driver: `[[faux:notify-probe]]` calls the `e2e_notify` fixture tool
 * (qa/fixtures/e2e-notify.ext.ts), whose execute() calls `ctx.ui.notify`. That
 * exercises the REAL path end to end: bridge notify proxy → `{type:"notify"}`
 * → server notify log + subscribers → client notify reducer → NotifyRenderer.
 *
 * Covers test-plan #F3, #F4, #F5, #F6, #F8, #F9.
 * See change: split-notify-from-prompt-request.
 */

const NOTIFY_TEXT = "e2e notify probe";
const PLAIN_TEXT_MARKER = "The quick brown faux jumps over the lazy dog.";

/** Rendered notification rows carrying the probe text. */
function notifyRows(page: import("@playwright/test").Page) {
  return page.getByText(NOTIFY_TEXT, { exact: false });
}

test.describe("notify channel — render-only, never a pending ask", () => {
  test("#F8 a notify-only session never reads 'Needs you'", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:notify-probe]] go");
    await expect(notifyRows(page).first()).toBeVisible({ timeout: 30_000 });

    // At rest: the notify must not have armed the prompt-derived tool state…
    await expect(card.getByText("Needs you")).toHaveCount(0);
    // …and must stay clear across a further tool turn (the re-arm is what made
    // the phantom permanent).
    await sendPrompt(page, "[[faux:plain-text]] go");
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText("Needs you")).toHaveCount(0);
  });

  test("#F9 (pinned negative) a genuine ask_user still reads 'Needs you'", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:ask-select]] go");
    await expect(page.getByRole("button", { name: /alpha/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(card.getByText("Needs you")).toBeVisible({ timeout: 15_000 });
  });

  test("#F3 the notify row keeps its transcript position", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    // assistant text → notify → assistant text
    await sendPrompt(page, "[[faux:plain-text]] first");
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 30_000 });
    await sendPrompt(page, "[[faux:notify-probe]] go");
    await expect(notifyRows(page).first()).toBeVisible({ timeout: 30_000 });
    await sendPrompt(page, "[[faux:plain-text]] second");
    await expect(page.getByText(PLAIN_TEXT_MARKER).nth(1)).toBeVisible({ timeout: 30_000 });

    // The notify row sits BETWEEN the two assistant rows.
    const firstY = (await page.getByText(PLAIN_TEXT_MARKER).first().boundingBox())!.y;
    const notifyY = (await notifyRows(page).first().boundingBox())!.y;
    const secondY = (await page.getByText(PLAIN_TEXT_MARKER).nth(1).boundingBox())!.y;
    expect(notifyY).toBeGreaterThan(firstY);
    expect(secondY).toBeGreaterThan(notifyY);
  });

  test("#F4/#F5 the notify survives a reload exactly once", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:notify-probe]] go");
    await expect(notifyRows(page).first()).toBeVisible({ timeout: 30_000 });
    await expect(notifyRows(page)).toHaveCount(1);

    // Let the debounced replay cursor flush so the reload re-subscribes as a
    // DELTA — the path where `replayNotifyLog` re-fires and could duplicate.
    await page.waitForTimeout(1_800);
    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });

    // #F4 durability: the row is back via the server notify log — a notify is
    // not a DashboardEvent, so the event store cannot restore it.
    await expect(notifyRows(page).first()).toBeVisible({ timeout: 60_000 });
    // #F5 idempotence: the client dedups by notifyId → exactly one row.
    await expect(notifyRows(page)).toHaveCount(1);
  });

  test("#F6 an ended session keeps its notification rows", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    await card.click();

    await sendPrompt(page, "[[faux:notify-probe]] go");
    await expect(notifyRows(page).first()).toBeVisible({ timeout: 30_000 });

    // End the session, then re-open it: the log is deliberately retained, so a
    // row visible while the session was alive must not vanish after it ends.
    // `force_kill` travels on the browser socket, so open a throwaway one.
    await page.evaluate(async (id) => {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${scheme}://${location.host}/ws`);
      await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
      ws.send(JSON.stringify({ type: "force_kill", sessionId: id }));
      await new Promise((r) => setTimeout(r, 1000));
      ws.close();
    }, sessionId);

    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
    const ended = page.locator(
      `[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`,
    );
    await ended.waitFor({ state: "visible", timeout: 60_000 });
    await ended.click();

    await expect(notifyRows(page).first()).toBeVisible({ timeout: 60_000 });
  });
});

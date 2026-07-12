import { expect, type Page, test } from "@playwright/test";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser-layer gate for change `fix-chat-scroll-to-top-estimate-drift`.
 *
 * The bug is a real-browser scroll-timing race: with the OLD static per-role
 * estimate, the largest rows near the top under-shot their true height 10-50x,
 * so as they mounted during an upward scroll `getTotalSize()` jumped and the top
 * RECEDED — index 0 was never reachable. jsdom has no layout engine, no real
 * scroll timing, and a no-op ResizeObserver, so ONLY this Playwright gate can
 * prove the fix; the vitest suite covers the pure estimate + the state machine.
 *
 * FIXTURE: `qa/fixtures/faux-scenarios.ts` -> `scroll-top-heavy` puts the biggest
 * rows (16k-char thinking, 9k-char text, 24k-char bash toolResult, inline image)
 * near the TOP, then ~40 small trailing turns. Tail = SCROLL_TOP_HEAVY_TAIL.
 */

// Sentinel resolved by the faux provider to the `scroll-top-heavy` scenario.
const HEAVY = "[[faux:scroll-top-heavy]] go";
// Keep in sync with SCROLL_TOP_HEAVY_TAIL in qa/fixtures/faux-scenarios.ts.
const TAIL = "scroll-top-heavy complete";

const chatScroll = (page: Page) => byTestId(page, "chatScrollContainer");
const scrollTopBtn = (page: Page) => byTestId(page, "scrollToTop");

async function metrics(page: Page) {
  return chatScroll(page).evaluate((el) => ({
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
}

async function startHeavy(page: Page): Promise<void> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await sendPrompt(page, HEAVY);
  await chatScroll(page).waitFor({ state: "visible" });
}

/** Wait until the whole transcript has streamed (tail committed → settled at bottom). */
async function waitForTail(page: Page): Promise<void> {
  await expect(page.getByText(TAIL).last()).toBeVisible({ timeout: 180_000 });
}

test.describe("chat transcript — scroll-to-top convergence (estimate-drift gate)", () => {
  // The scroll-top-heavy fixture streams ~40 turns of REAL bash tool calls (one
  // with a 24k-char result); that exceeds the default 60s per-test budget before
  // the tail commits. Triple it (test.slow → 180s) so waitForTail can elapse.
  test.slow();

  // ── ADDED: "Deterministic scroll-to-top affordance" + "Scroll-to-top lands
  //    on the first row" — including the async-image post-load remeasure. ────
  test("scroll-to-top lands on index 0 and stays after async image load", async ({ page }) => {
    await startHeavy(page);
    await waitForTail(page); // big rows are off-screen at the top

    // At the bottom the scroll-to-top control is visible (scrollTop > threshold).
    const btn = scrollTopBtn(page);
    await expect(btn).toBeVisible();
    await btn.click();

    // Converges on the first row despite the under-estimated big rows above.
    await expect
      .poll(async () => (await metrics(page)).scrollTop, { timeout: 20_000 })
      .toBeLessThanOrEqual(2);

    // The near-top inline image now decodes/loads async → the row remeasures.
    // scrollToIndex is bounded (maxAttempts=10); the onChange re-issue must keep
    // the view pinned to 0 through the post-load remeasure.
    await page
      .locator('[data-testid="chat-scroll-container"] img')
      .first()
      .evaluate(
        (img: HTMLImageElement) =>
          img.complete
            ? undefined
            : new Promise<void>((r) => {
                img.addEventListener("load", () => r(), { once: true });
                img.addEventListener("error", () => r(), { once: true });
              }),
      )
      .catch(() => {}); // tolerate no image mounted inside the top window
    await page.waitForTimeout(600);
    expect((await metrics(page)).scrollTop).toBeLessThanOrEqual(2);
  });

  // ── MODIFIED: "Scrolling up converges on the first row" — the top boundary
  //    must not recede faster than the user climbs. ──────────────────────────
  test("scrolling up converges on the first row (top does not recede)", async ({ page }) => {
    await startHeavy(page);
    await waitForTail(page);

    // Climb upward in steps. Pre-fix the top RECEDED (scrollTop never reached 0
    // as the big rows mounted + re-measured); post-fix it converges on 0.
    const scroller = chatScroll(page);
    for (let i = 0; i < 60; i++) {
      const { scrollTop } = await metrics(page);
      if (scrollTop <= 2) break;
      await scroller.evaluate((el) => el.scrollBy(0, -1200));
      await page.waitForTimeout(120);
    }
    await expect
      .poll(async () => (await metrics(page)).scrollTop, { timeout: 15_000 })
      .toBeLessThanOrEqual(2);

    // The first display row is mounted + reachable at the top.
    await expect(page.locator('[data-index="0"]')).toBeVisible();
  });
});

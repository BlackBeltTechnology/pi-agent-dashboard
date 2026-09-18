import { expect, type Page, test } from "./fixtures.js";
import { byTestId, gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 gate for change `fix-long-session-ux-degradation` (test-plan #P4,
 * capability `chat-scroll-lock`, design D5).
 *
 * ── The row this file exists for ────────────────────────────────────────────
 * A bottom-pin writes `el.scrollTop = el.scrollHeight`, but the browser clamps
 * that write to the extent that exists AT WRITE TIME. Rows below the viewport
 * then measure in and grow `scrollHeight` (baseline repro: 21 136 → 39 578)
 * before the pin's induced scroll event dispatches. That event reports a
 * position far from the new bottom (baseline defect: `scrollTop 25521 / max
 * 38909`) with NO user gesture, and the old `handleScroll` treated it as an
 * escape — the follow died and the view parked mid-transcript.
 *
 * ── Why only this layer can prove it ────────────────────────────────────────
 * The defect is a measurement-timing race. jsdom has no layout engine and a
 * no-op ResizeObserver, so rows never actually grow; the vitest suite covers the
 * writer-attribution state machine (`ChatView.scroll-race.test.tsx`), and this
 * gate covers the real convergence it enables.
 *
 * FIXTURE: `[[faux:long-transcript]]` (see `qa/fixtures/faux-scenarios.ts`), sent
 * more than once so the transcript is large enough that rows measure in
 * progressively after the pin. The session is built, then RE-OPENED, so the
 * client replays it from scratch — the pin happens against estimated row heights.
 *
 * See change: fix-long-session-ux-degradation (D5).
 */

const TAIL = /long-transcript complete/;
/** Each transcript is ~604 events; two buys a transcript tall enough to measure in. */
const TRANSCRIPTS = 2;

const chatScroll = (page: Page) => byTestId(page, "chatScrollContainer");
const scrollBottomBtn = (page: Page) => byTestId(page, "scrollToBottom");

async function metrics(page: Page) {
  return chatScroll(page).evaluate((el) => ({
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
}

/**
 * Wait until `scrollTop` stops changing across two samples. The view is chasing
 * the bottom as rows measure in, so an immediate assertion would race the
 * convergence rather than observe it.
 */
async function waitForSettle(page: Page, timeoutMs = 60_000): Promise<void> {
  let last = -1;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    const { scrollTop } = await metrics(page);
    if (scrollTop === last) return;
    last = scrollTop;
  }
}

test.describe("chat transcript — long-session settle", () => {
  test.setTimeout(900_000);

  test("P4: a long session opens at the latest message, not part-way up", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();
    await card.click();

    for (let i = 0; i < TRANSCRIPTS; i++) {
      await sendPrompt(page, "[[faux:long-transcript]] go");
      await expect(page.getByText(TAIL).nth(i)).toBeVisible({ timeout: 300_000 });
      await page.waitForTimeout(1_000);
    }
    await page.waitForTimeout(2_000);

    // Leave and re-open: ChatView unmounts, so the next open is a fresh replay
    // whose bottom-pin races the rows measuring in.
    await gotoDashboard(page);
    await page.locator(`[data-session-id="${sessionId}"]`).first().click();
    await chatScroll(page).waitFor({ state: "visible", timeout: 60_000 });

    // Wait for the FINAL tail marker before sampling: `waitForSettle` can return
    // after 500 ms of unchanged scrolling BETWEEN replay batches, so without this
    // the assertion could inspect a partial replay.
    await expect(page.getByText(TAIL).nth(TRANSCRIPTS - 1)).toBeVisible({ timeout: 300_000 });

    await waitForSettle(page);

    const { scrollTop, scrollHeight, clientHeight } = await metrics(page);
    const maxScrollTop = scrollHeight - clientHeight;
    const distanceFromBottom = maxScrollTop - scrollTop;
    // Baseline defect rested ~13 400px above the bottom on a ~39 000px max.
    expect(
      distanceFromBottom,
      `view rested ${distanceFromBottom}px above the bottom (scrollTop ${scrollTop} / max ${maxScrollTop})`,
    ).toBeLessThanOrEqual(clientHeight);

    // The escape affordance must not be visible: no gesture occurred.
    await expect(scrollBottomBtn(page)).toBeHidden();
  });
});

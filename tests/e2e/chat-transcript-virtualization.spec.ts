import { expect, type Locator, type Page, test } from "@playwright/test";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser-layer gate for change `virtualize-chat-transcript-tanstack` (Phase 2
 * Step B) and its preserved `chat-scroll-lock` contract.
 *
 * These scenarios are the ONLY honest way to validate the parts jsdom / vitest
 * cannot: real scroll heights, follow-while-pinned, windowing (unmounted rows),
 * the multi-batch event_replay race, and off-screen scrollToTurn. Each test is
 * tagged with the spec requirement it gates.
 *
 * FIXTURE: `qa/fixtures/faux-scenarios.ts` → `long-transcript` streams ~120
 * heterogeneous turns (thinking + text + a distinct bash call) so the transcript
 * spans several viewports. The tail is `LONG_TRANSCRIPT_TAIL` (mirrored below).
 *
 * SCROLL HANDLE: the transcript scroller carries data-testid="chat-scroll-container"
 * (TESTIDS.chatScrollContainer) — the windowed list needs a stable getScrollElement
 * node anyway, so reading scrollTop/scrollHeight off it is justified.
 *
 * WINDOWING PROOF: mounted rows are counted via `[data-index]` (the absolutely
 * positioned virtual-row wrappers), NOT `[data-turn]` (only on user rows). With
 * windowing this is bounded by viewport + overscan, far below the total.
 */

// Sentinel resolved by the faux provider to the `long-transcript` scenario.
const LONG = "[[faux:long-transcript]] go";
// Navigable variant (40 turns) for the scroll-to-TURN test: a faux scenario has
// ONE user turn, so only turn 0 gets a turnIndex; 40 turns keeps its per-turn
// stat inside the client MAX_TURN_STATS=50 window so the clickable `turn-bar`
// affordance renders, while still pushing turn 0 off-screen.
const LONG_NAV = "[[faux:long-transcript-nav]] go";
// Keep in sync with LONG_TRANSCRIPT_TAIL in qa/fixtures/faux-scenarios.ts
// (duplicated so this spec does not import the pi-ai-laden fixture module).
const LONG_TRANSCRIPT_TAIL = "long-transcript complete";

const chatScroll = (page: Page) => byTestId(page, "chatScrollContainer");
const scrollToBottomBtn = (page: Page) => byTestId(page, "scrollToBottom");

async function metrics(page: Page) {
  return chatScroll(page).evaluate((el) => ({
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    distanceFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
    // Windowing proof: mounted virtual-row wrappers, bounded by the viewport.
    mountedRows: el.querySelectorAll("[data-index]").length,
  }));
}

/**
 * Send a long-transcript prompt and wait until enough has streamed for a >50px
 * scroll-up. Returns the session card so a caller can switch back to it later.
 */
async function startLongStream(page: Page, prompt: string = LONG): Promise<Locator> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await sendPrompt(page, prompt);
  await chatScroll(page).waitFor({ state: "visible" });
  await expect
    .poll(async () => (await metrics(page)).scrollHeight - (await metrics(page)).clientHeight, {
      timeout: 60_000,
    })
    .toBeGreaterThan(600);
  return card;
}

/** Wait until the whole long transcript has streamed (tail message committed). */
async function waitForTail(page: Page): Promise<void> {
  await expect(page.getByText(LONG_TRANSCRIPT_TAIL).last()).toBeVisible({ timeout: 240_000 });
}

test.describe("chat transcript — scroll-lock + virtualization (Step B gate)", () => {
  // ── chat-scroll-lock: "Scroll lock when user scrolls up" ──────────────────
  test("50px lock: scrolling up during streaming stops auto-follow", async ({ page }) => {
    await startLongStream(page);

    // Scroll up >50px while content is still streaming.
    await chatScroll(page).evaluate((el) => el.scrollBy(0, -400));
    const before = await metrics(page);
    expect(before.distanceFromBottom).toBeGreaterThan(50);

    // New streamed content must NOT pull the viewport down.
    await page.waitForTimeout(1_500);
    const after = await metrics(page);
    expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThan(4);
  });

  // ── chat-scroll-lock: "Scroll-to-bottom button" ───────────────────────────
  test("scroll-to-bottom button: appears when up, hides at bottom, click resumes", async ({ page }) => {
    await startLongStream(page);

    const btn = scrollToBottomBtn(page);
    await chatScroll(page).evaluate((el) => el.scrollBy(0, -400));
    await expect(btn).toBeVisible();

    await btn.click();
    await expect(btn).toBeHidden();
    // Content is still streaming: a row can land between the resume-scroll and the
    // read, momentarily pushing the bottom away. Poll until follow settles it.
    await expect
      .poll(async () => (await metrics(page)).distanceFromBottom, { timeout: 10_000 })
      .toBeLessThan(50);
  });

  // ── chat-scroll-lock: "Resume within 50px" (no button click) ───────────────
  test("resume within 50px: manually scrolling back near bottom re-arms follow", async ({ page }) => {
    await startLongStream(page);
    const btn = scrollToBottomBtn(page);

    // Scroll up → follow suspends, button shows.
    await chatScroll(page).evaluate((el) => el.scrollBy(0, -400));
    await expect(btn).toBeVisible();

    // Manually scroll back to WITHIN the 50px threshold — not a button click and
    // not exactly bottom. The threshold re-arms follow, so streaming content pins
    // the bottom again and the button hides. If follow did NOT re-arm, content
    // would append below and distanceFromBottom would grow instead.
    await chatScroll(page).evaluate((el) => el.scrollTo(0, el.scrollHeight - el.clientHeight - 25));
    await expect
      .poll(async () => (await metrics(page)).distanceFromBottom, { timeout: 10_000 })
      .toBeLessThan(50);
    await expect(btn).toBeHidden();
  });

  // ── chat-scroll-lock: "Auto-scroll robust to multi-batch replay" ──────────
  test("reload lands at latest message after multi-batch event_replay", async ({ page }) => {
    // The 120-turn fixture fires 120 real bash tool calls before the tail; the
    // full stream cannot settle inside the 60s default. waitForTail budgets 240s (headroom for real-bash streaming under load).
    test.setTimeout(300_000);
    await startLongStream(page);
    await waitForTail(page); // full transcript persisted before reload

    // Reload: server replays the (uncached) transcript in batches. Final
    // position must be the bottom, button hidden — no mid-replay false lock.
    await page.reload();
    await chatScroll(page).waitFor({ state: "visible" });
    await expect
      .poll(async () => (await metrics(page)).distanceFromBottom, { timeout: 30_000 })
      .toBeLessThan(50);
    await expect(scrollToBottomBtn(page)).toBeHidden();
  });

  // ── chat-scroll-lock: "Real user scroll during replay still wins" ──────────
  test("user scroll-up mid-replay wins over programmatic follow", async ({ page }) => {
    test.setTimeout(300_000);
    await startLongStream(page); // LONG (120 turns) → a long, batched replay window
    await waitForTail(page); // full transcript persisted server-side

    // Reload: the server replays the transcript in batches, programmatically
    // pinning the bottom (per-batch auto-pin runs only while stickToBottom holds).
    await page.reload();
    await chatScroll(page).waitFor({ state: "visible" });
    // Wait until replay has produced enough content to scroll but is still ongoing.
    await expect
      .poll(async () => (await metrics(page)).scrollHeight - (await metrics(page)).clientHeight, {
        timeout: 30_000,
      })
      .toBeGreaterThan(600);

    // A REAL user scroll-up mid-replay must flip follow off and STAY off — the
    // remaining batches append below without yanking the viewport to bottom.
    await chatScroll(page).evaluate((el) => el.scrollBy(0, -400));
    await page.waitForTimeout(3_000); // let the rest of the replay batches land

    const m = await metrics(page);
    expect(m.distanceFromBottom).toBeGreaterThan(50);
    await expect(scrollToBottomBtn(page)).toBeVisible();
  });

  // ── chat-transcript-virtualization: "Jump to an off-screen turn" ──────────
  test("scrollToTurn reaches an unmounted (off-screen) turn", async ({ page }) => {
    // ChatViewHandle.scrollToTurn -> virtualizer.scrollToIndex. The OLD
    // querySelector path returned null for an unmounted turn; the map-based path
    // scrolls it into view. The TokenStatsBar turn bar (turn 0) is the jump
    // affordance — long-transcript-nav (40 turns) keeps it inside MAX_TURN_STATS.
    test.setTimeout(300_000); // full stream must settle (waitForTail 240s)
    await startLongStream(page, LONG_NAV);
    await waitForTail(page); // settled at bottom; turn 0 is off-screen above

    const firstTurnBar = byTestId(page, "turnBar").first();
    await firstTurnBar.waitFor({ state: "visible", timeout: 30_000 });
    await firstTurnBar.click();

    // Jumping to the oldest turn scrolls far up from the bottom and suspends
    // follow (scroll-to-bottom button appears).
    await expect
      .poll(async () => (await metrics(page)).distanceFromBottom, { timeout: 15_000 })
      .toBeGreaterThan(200);
    await expect(scrollToBottomBtn(page)).toBeVisible();
  });

  // ── chat-transcript-virtualization: "Streaming tail always rendered" ──────
  test("streaming tail stays mounted while scrolled up in history", async ({ page }) => {
    await startLongStream(page);

    // The live streaming bubble renders as `.chat-stream-live` (a static sibling
    // BELOW the virtual spacer — never windowed). Catch it mid-stream, scroll far
    // up, and assert it is still attached even though below the viewport.
    const live = page.locator(".chat-stream-live");
    await live.first().waitFor({ state: "attached", timeout: 60_000 });
    await chatScroll(page).evaluate((el) => el.scrollTo(0, 0));
    expect(await live.count()).toBeGreaterThan(0);
  });

  // ── chat-transcript-virtualization: "Streaming tail growth stays pinned" ──
  test("streaming growth keeps the bottom pinned while following", async ({ page }) => {
    await startLongStream(page);
    const first = await metrics(page);

    // Following at bottom: as new rows append and the live tail grows, the
    // viewport must stay pinned. Sample across several stream frames.
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(600);
      expect((await metrics(page)).distanceFromBottom).toBeLessThan(50);
    }

    // Growth actually happened during the window (a settled transcript would
    // make the pin assertion vacuous).
    expect((await metrics(page)).scrollHeight).toBeGreaterThan(first.scrollHeight);
  });

  // ── chat-transcript-virtualization: "Layout/node count bounded" ───────────
  test("mounted row count is bounded by the viewport, not session length", async ({ page }) => {
    test.setTimeout(300_000); // full 120-turn stream must settle (waitForTail 240s)
    await startLongStream(page);
    await waitForTail(page); // ~120 turns → hundreds of display rows total

    // With windowing, only viewport + overscan (+ streaming tail siblings) are
    // mounted. Pre-Step-B this equalled the total row count (hundreds); post-Step-B
    // it is bounded well below.
    const { mountedRows } = await metrics(page);
    expect(mountedRows).toBeGreaterThan(0);
    expect(mountedRows).toBeLessThan(60);
  });

  // ── task 8.2: collapsing an ABOVE-viewport tool group does not yank ───────
  test("toggling an above-viewport tool group does not yank the viewport", async ({ page }) => {
    test.setTimeout(300_000);
    await startLongStream(page);
    await waitForTail(page); // ~120 single-member burst groups, each collapsible

    // Park at mid-scroll so follow is OFF (stickToBottom false) and there are
    // mounted burst groups both above the fold (in the overscan band) and in view.
    await chatScroll(page).evaluate((el) => el.scrollTo(0, Math.floor(el.scrollHeight / 2)));
    await page.waitForTimeout(400);

    // Record a VISIBLE anchor row's on-screen Y, then toggle the topmost mounted
    // tool-burst-header that sits fully ABOVE the fold — via dispatchEvent so the
    // element is NOT scrolled into view first. That height change is above the
    // scroll offset; TanStack's measure-driven scroll adjustment (with
    // overflowAnchor:none stopping the browser from double-compensating) must
    // keep the visible content put.
    const setup = await chatScroll(page).evaluate((el) => {
      const contTop = el.getBoundingClientRect().top;
      const rows = [...el.querySelectorAll("[data-index]")] as HTMLElement[];
      const anchor = rows.find((r) => r.getBoundingClientRect().top >= contTop + 120);
      const headers = [...el.querySelectorAll('[data-testid="tool-burst-header"]')] as HTMLElement[];
      headers.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      const above = headers[0];
      if (!anchor) return { ok: false as const, reason: "no-anchor" };
      if (!above) return { ok: false as const, reason: "no-header" };
      if (above.getBoundingClientRect().bottom > contTop) return { ok: false as const, reason: "header-not-above" };
      const anchorIndex = anchor.getAttribute("data-index");
      const anchorTopBefore = anchor.getBoundingClientRect().top;
      above.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return { ok: true as const, anchorIndex, anchorTopBefore };
    });
    if (!setup.ok) throw new Error(`8.2 setup failed: ${setup.reason}`);

    await page.waitForTimeout(400); // ResizeObserver re-measure + scroll adjust

    // NOTE: Locator.evaluate passes (element, arg) — the element is FIRST.
    const anchorTopAfter = await chatScroll(page).evaluate((el, idx) => {
      const a = el.querySelector(`[data-index="${idx}"]`) as HTMLElement | null;
      return a ? a.getBoundingClientRect().top : Number.NaN;
    }, setup.anchorIndex);

    expect(Number.isNaN(anchorTopAfter)).toBe(false);
    // The visible anchor must not jump: the measure-driven scroll adjustment
    // absorbs the above-fold height change. Allow a few px for sub-pixel re-measure.
    expect(Math.abs(anchorTopAfter - setup.anchorTopBefore)).toBeLessThan(8);
  });

  // ── task 7.2: per-session scroll persistence across a session switch ───────
  test("switching away mid-scroll and back restores the anchored row, not bottom", async ({ page }) => {
    test.setTimeout(300_000);

    // Spawn the OTHER session (B) FIRST: spawnFreshGitSession → gotoDashboard
    // does a full page.goto reload that wipes the in-memory scrollStateMap.
    // Streaming A last means its later reload is the FINAL one, so the anchor
    // saved after scrolling A survives until we switch. B stays empty.
    const cardB = await spawnFreshGitSession(page);
    const bId = await cardB.getAttribute("data-session-id");
    expect(bId).toBeTruthy();

    // Session A: stream the navigable transcript and settle at bottom.
    const cardA = await startLongStream(page, LONG_NAV);
    const aId = await cardA.getAttribute("data-session-id");
    expect(aId).toBeTruthy();
    await waitForTail(page);

    // Scroll A to the top: follow suspends (button appears) and handleScroll
    // persists the virtual anchor for A. Capture the not-at-bottom position.
    await chatScroll(page).evaluate((el) => el.scrollTo(0, 0));
    await expect(scrollToBottomBtn(page)).toBeVisible();
    const away = await metrics(page);
    expect(away.distanceFromBottom).toBeGreaterThan(200);

    // Switch to B, then back to A — both are client-side wouter nav (no reload),
    // so scrollStateMap persists. The URL (/session/:id) confirms each switch.
    await page.locator(`[data-session-id="${bId}"]`).first().click();
    await page.waitForURL((url) => url.href.includes(bId as string), { timeout: 15_000 });
    await page.locator(`[data-session-id="${aId}"]`).first().click();
    await page.waitForURL((url) => url.href.includes(aId as string), { timeout: 15_000 });

    // Restore must re-anchor A to the saved (non-bottom) row — NOT jump to
    // bottom. distanceFromBottom stays large and the button stays visible.
    await chatScroll(page).waitFor({ state: "visible" });
    await expect
      .poll(async () => (await metrics(page)).distanceFromBottom, { timeout: 15_000 })
      .toBeGreaterThan(200);
    await expect(scrollToBottomBtn(page)).toBeVisible();
  });
});

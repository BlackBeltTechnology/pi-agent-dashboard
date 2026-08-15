import { expect, type Page, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * L3 gate for change: show-replay-in-flight-indicator.
 *
 * Scenario mapping (test-plan.md):
 *   F9  — the pill is visible while a real MULTI-BATCH replay streams and is
 *         gone once the transcript settles.
 *   F11 — the pill OVERLAYS the list: an anchor row's box is unchanged both
 *         while the pill is up with batches still landing, and across the
 *         disappear transition. The anchor is pinned by `data-index` with the
 *         bottom-pin released, so the two samples measure the SAME element and
 *         a legitimate scroll cannot masquerade as a reflow.
 *   X6  — a stalled transfer keeps the pill up for the whole stall; it clears
 *         only when the transcript completes.
 *   F10 — the warm rehydrate → `subscribe { lastSeq }` → empty-delta reload
 *         path never paints the pill.
 *   G5  — (change: fix-replay-pill-a11y-and-collision) at a 375px viewport the
 *         indicator label does not intersect the scroll-to-bottom control and
 *         that control stays operable for the whole time the indicator shows.
 *         This is the ONLY level where the occlusion defect is observable:
 *         jsdom has no layout engine, so a component-level overlap assertion
 *         returns zeroed rects and passes vacuously (design D6).
 *
 * Two properties this spec must actually establish, not merely assume:
 *
 *   1. MULTI-BATCH. `[[faux:long-transcript]]` streams ~120 turns, so the
 *      replay window comfortably exceeds the server's `REPLAY_BATCH_SIZE`
 *      (200) — a couple of `plain-text` turns would not, and the pill could
 *      then be observed on a SINGLE-batch replay that never exercises the
 *      re-arm path. The batch arithmetic itself is gated deterministically at
 *      L1 (E7/E8/E9 in `subscription-handler.test.ts`).
 *   2. SERIALIZED STALL. `stallServerToClientWs` releases server→client frames
 *      through a SEQUENTIAL queue with a per-frame gap. A naive "await N ms in
 *      every handler" starts every delay concurrently, so the content and
 *      terminal frames can land together and the pill would never be observed
 *      mid-transfer. The queue guarantees the terminal frame is still pending
 *      while earlier batches have already painted.
 *
 * CDP `emulateNetworkConditions` does NOT throttle an already-open WS, hence
 * `page.routeWebSocket` — same technique as `optimistic-prompt.spec.ts`.
 *
 * The harness port comes from the shared `BASE_URL` (derived from
 * `.pi-test-harness.json`), never a hardcoded `:18000`.
 */

// Keep in sync with LONG_TRANSCRIPT_TAIL in qa/fixtures/faux-scenarios.ts
const LONG_TRANSCRIPT_TAIL = "long-transcript complete";
const PLAIN_TEXT_MARKER = "The quick brown faux jumps over the lazy dog.";
const PILL = "replay-in-flight-pill";
const SCROLL_BOTTOM = "scroll-to-bottom";

type Box = { x: number; y: number; width: number; height: number };

/** Axis-aligned box intersection, in CSS pixels. */
function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Close the OpenSpec Propose dialog if selecting the card happened to open it.
 * Its backdrop covers the viewport, so leaving it up makes every later click
 * time out on "subtree intercepts pointer events" rather than on anything this
 * spec is about.
 */
async function dismissProposeDialog(page: Page): Promise<void> {
  const overlay = page.locator('[data-testid="propose-dialog-overlay"]');
  if (!(await overlay.isVisible().catch(() => false))) return;
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden({ timeout: 5_000 });
}

/**
 * Serialize server→client frames with a fixed inter-frame gap, so a multi-batch
 * replay is genuinely spread over time instead of arriving in one clump.
 */
async function stallServerToClientWs(page: Page, gapMs: number): Promise<void> {
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m)); // client→server: immediate
    let chain = Promise.resolve();
    server.onMessage((m) => {
      // Sequential queue: each frame waits for the previous one to be released.
      chain = chain.then(async () => {
        await new Promise((r) => setTimeout(r, gapMs));
        ws.send(m);
      });
    });
  });
}

/** Record every insertion of the pill into the DOM, across navigations. */
async function recordPillSightings(page: Page): Promise<void> {
  await page.addInitScript((testid: string) => {
    (window as unknown as { __pillSeen?: boolean }).__pillSeen = false;
    const mark = () => {
      (window as unknown as { __pillSeen?: boolean }).__pillSeen = true;
    };
    const check = (node: Node) => {
      if (!(node instanceof Element)) return;
      if (node.matches(`[data-testid="${testid}"]`) || node.querySelector(`[data-testid="${testid}"]`)) mark();
    };
    const start = () => {
      if (document.querySelector(`[data-testid="${testid}"]`)) mark();
      new MutationObserver((records) => {
        for (const r of records) for (const n of Array.from(r.addedNodes)) check(n);
      }).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) start();
    else document.addEventListener("DOMContentLoaded", start);
  }, PILL);
}

const pillEverSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pillSeen?: boolean }).__pillSeen === true);

test.describe("replay-in-flight pill", () => {
  // A ~120-turn faux transcript plus a second-context cold replay over a
  // deliberately serialized socket. On a cold container this also pays the
  // first-spawn cost.
  test.setTimeout(300_000);

  test("F9/F11/X6 pill is visible for the whole stalled multi-batch replay, overlays the list, then clears", async ({
    page,
    browser,
  }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();

    await card.click();
    await dismissProposeDialog(page);
    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 60_000 });
    await composer.fill("warmup");
    await expect(page.getByTestId("send-button")).toBeEnabled({ timeout: 120_000 });
    await composer.fill("");
    // ~120 turns → the replay window exceeds REPLAY_BATCH_SIZE (200 events).
    await sendPrompt(page, "[[faux:long-transcript]] go");
    await expect(page.getByText(LONG_TRANSCRIPT_TAIL).last()).toBeVisible({ timeout: 180_000 });
    await page.waitForTimeout(1_000);

    // A SECOND context has an empty IndexedDB → subscribes with lastSeq 0 →
    // a full cold replay, released one frame at a time.
    const ctx2 = await browser.newContext({ baseURL: BASE_URL });
    try {
      const page2 = await ctx2.newPage();
      await stallServerToClientWs(page2, 250);
      await page2.goto(`/session/${sessionId}`);

      const pill = page2.locator(`[data-testid="${PILL}"]`);
      await expect(pill).toBeVisible({ timeout: 120_000 });

      // The pill is up while EARLIER batches have already painted — i.e. we are
      // mid-transfer, not merely pre-transfer. This is what makes F9 about a
      // multi-batch replay rather than a single terminal frame.
      await expect(page2.locator(".chat-cv").getByText(/\S/).first()).toBeVisible({ timeout: 120_000 });

      // F11 needs the SAME element measured at both instants. Two things would
      // otherwise make the comparison meaningless:
      //   1. "the last row" is a different element at each sample — the tail
      //      marker rides the terminal batch, so at the appear sample it does
      //      not exist yet and a marker-based lookup falls back to whatever row
      //      happens to be last. Comparing those two measures row alignment,
      //      not the indicator. So the anchor is pinned by `data-index`.
      //   2. with the bottom-pin armed, every arriving batch legitimately moves
      //      the rendered rows. So the pin is released first (a real wheel
      //      gesture, which `cancelDescent` honours) and the anchor is chosen
      //      from the rows already painted. New content then lands BELOW it and
      //      the anchor must not move at all — which lets `y` be pinned too,
      //      the axis an in-flow insertion would actually shift.
      await page2.locator(".chat-cv").first().hover();
      await page2.mouse.wheel(0, -400);
      const anchorIndex = await page2.locator(".chat-cv [data-index]").last().getAttribute("data-index");
      expect(anchorIndex, "no virtualized row to anchor on").not.toBeNull();
      const anchor = page2.locator(`.chat-cv [data-index="${anchorIndex}"]`);
      const boxAtAppear = await anchor.boundingBox();
      expect(boxAtAppear).not.toBeNull();

      // X6: the pill survives a multi-second stall rather than flickering out.
      await page2.waitForTimeout(2_500);
      await expect(pill).toBeVisible();

      // F11a: batches are still landing and the indicator is still up — the
      // anchor has not budged, so the indicator is not occupying list space.
      expect(await anchor.boundingBox()).toEqual(boxAtAppear);

      // The terminal batch lands → the flag clears → the pill goes.
      await expect(pill).toHaveCount(0, { timeout: 180_000 });

      // F11b: removing the indicator did not reflow the list either.
      expect(await anchor.boundingBox()).toEqual(boxAtAppear);

      // The transcript really did complete — the pill cleared on the terminal
      // batch, not on a stall. Re-arm the bottom-pin first, since F11 released
      // it and the tail is now below the viewport.
      await page2.locator(`[data-testid="${SCROLL_BOTTOM}"]`).click();
      await expect(page2.getByText(LONG_TRANSCRIPT_TAIL).last()).toBeVisible({ timeout: 60_000 });
    } finally {
      await ctx2.close();
    }
  });

  test("G5 at 375px the indicator never occludes the scroll-to-bottom control, which stays clickable", async ({
    page,
    browser,
  }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();

    await card.click();
    // A card click lands on the card's centre, which on a single-card dashboard
    // can be its OpenSpec "Propose" action. The dialog's backdrop then
    // intercepts every later click, including the composer's send button.
    await dismissProposeDialog(page);
    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 60_000 });
    await composer.fill("warmup");
    await expect(page.getByTestId("send-button")).toBeEnabled({ timeout: 120_000 });
    await composer.fill("");
    await sendPrompt(page, "[[faux:long-transcript]] go");
    // Settling on the tail marker is the real precondition for the second
    // context's cold replay — no fixed sleep, which would only be a flake
    // source on a cold container.
    await expect(page.getByText(LONG_TRANSCRIPT_TAIL).last()).toBeVisible({ timeout: 180_000 });

    // Same cold-replay-over-a-stalled-socket setup as F9/X6 — a second context
    // with an empty IndexedDB — so the indicator is up long enough to measure.
    // Reusing that fixture rather than adding a second one keeps the two specs
    // observing the SAME state.
    const ctx2 = await browser.newContext({ baseURL: BASE_URL });
    try {
      const page2 = await ctx2.newPage();
      await page2.setViewportSize({ width: 375, height: 800 });
      await stallServerToClientWs(page2, 250);
      await page2.goto(`/session/${sessionId}`);

      const pill = page2.locator(`[data-testid="${PILL}"]`);
      await expect(pill).toBeVisible({ timeout: 120_000 });

      // The scroll-to-bottom control only renders once the transcript is
      // scrolled away from the bottom, so reveal it with a real gesture.
      const scroller = page2.locator(".chat-cv").first();
      await scroller.hover();
      const bottomBtn = page2.locator(`[data-testid="${SCROLL_BOTTOM}"]`);
      await expect(async () => {
        await page2.mouse.wheel(0, -600);
        await expect(bottomBtn).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 60_000 });

      // Both overlays are up at the same instant — the state the defect needs.
      await expect(pill).toBeVisible();
      const pillBox = await pill.boundingBox();
      const btnBox = await bottomBtn.boundingBox();
      expect(pillBox, "indicator has no box").not.toBeNull();
      expect(btnBox, "scroll-to-bottom has no box").not.toBeNull();

      // THE defect: at equal z-index the corner chip painted over the button.
      expect(
        intersects(pillBox as Box, btnBox as Box),
        `indicator ${JSON.stringify(pillBox)} intersects scroll-to-bottom ${JSON.stringify(btnBox)}`,
      ).toBe(false);

      // Occlusion, not absence, is the defect: the button was always in the DOM.
      // `click()` performs Playwright's actionability + hit-target check, so it
      // fails if another element covers the point — which is exactly what an
      // occluding overlay does.
      await expect(pill).toBeVisible();
      await bottomBtn.click({ timeout: 10_000 });
    } finally {
      await ctx2.close();
    }
  });

  test("F10 a warm reload taking the empty-delta path never paints the pill", async ({ page }) => {
    // Installed BEFORE any navigation so it survives the reload and cannot miss
    // a short-lived pill the way interval polling would.
    await recordPillSightings(page);

    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();

    await card.click();
    await dismissProposeDialog(page);
    await sendPrompt(page, "[[faux:plain-text]] go");
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 45_000 });

    // Let the debounced replay-cache writer (1s) flush maxSeq to IndexedDB, so
    // the post-reload subscribe carries a cursor and the delta is empty.
    await page.waitForTimeout(1_800);
    expect(await pillEverSeen(page)).toBe(false);

    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 45_000 });
    await page.waitForTimeout(2_000);

    expect(await pillEverSeen(page)).toBe(false);
    await expect(page.locator(`[data-testid="${PILL}"]`)).toHaveCount(0);
  });
});

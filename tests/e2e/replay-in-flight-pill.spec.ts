import { expect, type Page, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * L3 gate for change: show-replay-in-flight-indicator.
 *
 * Scenario mapping (test-plan.md):
 *   F9  — the pill is visible while a real MULTI-BATCH replay streams and is
 *         gone once the transcript settles.
 *   F11 — the pill OVERLAYS the list: the last message row's box is unchanged
 *         across both the appear and the disappear transition.
 *   X6  — a stalled transfer keeps the pill up for the whole stall; it clears
 *         only when the transcript completes.
 *   F10 — the warm rehydrate → `subscribe { lastSeq }` → empty-delta reload
 *         path never paints the pill.
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
      const boxAtAppear = await lastRowBox(page2);
      expect(boxAtAppear).not.toBeNull();

      // X6: the pill survives a multi-second stall rather than flickering out.
      await page2.waitForTimeout(2_500);
      await expect(pill).toBeVisible();

      // The terminal batch lands → the flag clears → the pill goes.
      await expect(pill).toHaveCount(0, { timeout: 180_000 });
      await expect(page2.getByText(LONG_TRANSCRIPT_TAIL).last()).toBeVisible({ timeout: 60_000 });

      // F11: the row the pill overlays keeps its geometry across the clear.
      // `y` is deliberately NOT pinned across the two samples — replay rows are
      // still landing between them, so a `y` delta measures content growth, not
      // the pill. `x`/`width`/`height` are what an in-flow insertion would move.
      const boxAtClear = await lastRowBox(page2);
      expect(boxAtClear?.x).toBeCloseTo(boxAtAppear?.x as number, 0);
      expect(boxAtClear?.width).toBeCloseTo(boxAtAppear?.width as number, 0);
      expect(boxAtClear?.height).toBeCloseTo(boxAtAppear?.height as number, 0);
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

/**
 * Bounding box of the last rendered assistant text row. The transcript has no
 * per-row testid, so the faux tail marker is the row handle.
 */
async function lastRowBox(page: Page) {
  const rows = page.getByText(LONG_TRANSCRIPT_TAIL);
  if ((await rows.count()) === 0) {
    const any = page.locator(".chat-cv [data-index]");
    if ((await any.count()) === 0) return null;
    return await any.last().boundingBox();
  }
  return await rows.last().boundingBox();
}

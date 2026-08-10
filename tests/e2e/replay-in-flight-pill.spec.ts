import { expect, type Page, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * L3 gate for change: show-replay-in-flight-indicator.
 *
 * Scenario mapping (test-plan.md):
 *   F9  — the pill is visible while a real multi-batch replay streams and is
 *         gone once the transcript settles.
 *   F11 — the pill OVERLAYS the list: the last message row's bounding box is
 *         unchanged across both the appear and the disappear transition.
 *   X6  — a stalled transfer keeps the pill up for the whole stall; it clears
 *         only when the transcript completes.
 *   F10 — the warm rehydrate → `subscribe { lastSeq }` → empty-delta reload
 *         path never paints the pill.
 *
 * A real replay against the local harness resolves far faster than the
 * `REPLAY_PILL_DELAY_MS` show-delay, so F9/F11/X6 delay every server→client
 * WebSocket frame (`page.routeWebSocket`) to widen the transfer window. CDP
 * `emulateNetworkConditions` does NOT throttle an already-open WS — same
 * technique and rationale as `optimistic-prompt.spec.ts`.
 *
 * The harness port comes from the shared `BASE_URL` (derived from
 * `.pi-test-harness.json`), never a hardcoded `:18000`.
 */

const PLAIN_TEXT_MARKER = "The quick brown faux jumps over the lazy dog.";
const PILL = "replay-in-flight-pill";

/** Delay every server→client frame so the replay transfer window is observable. */
async function delayServerToClientWs(page: Page, ms: number): Promise<void> {
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m)); // client→server: immediate
    server.onMessage(async (m) => {
      await new Promise((r) => setTimeout(r, ms)); // server→client: delayed
      ws.send(m);
    });
  });
}

test.describe("replay-in-flight pill", () => {
  // A faux round-trip plus a second-context cold replay over a deliberately
  // slowed socket. On a cold container this also pays the first-spawn cost.
  test.setTimeout(180_000);

  test("F9/F11/X6 pill is visible for the whole stalled replay, overlays the list, then clears", async ({
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
    // Two turns so the replay window carries a real transcript to paint.
    await sendPrompt(page, "[[faux:plain-text]] go");
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 45_000 });
    await sendPrompt(page, "[[faux:plain-text]] again");
    await expect(page.getByText(PLAIN_TEXT_MARKER).nth(1)).toBeVisible({ timeout: 45_000 });
    await page.waitForTimeout(1_000);

    // A SECOND context has an empty IndexedDB → subscribes with lastSeq 0 →
    // a full cold replay. Every server→client frame is delayed, so the batches
    // stall on the wire well past the show-delay (X6: > 2s total).
    const ctx2 = await browser.newContext({ baseURL: BASE_URL });
    try {
      const page2 = await ctx2.newPage();
      await delayServerToClientWs(page2, 1_200);
      await page2.goto(`/session/${sessionId}`);

      const pill = page2.locator(`[data-testid="${PILL}"]`);
      await expect(pill).toBeVisible({ timeout: 60_000 });

      // F11 (appear): with the pill up AND content already painted, capture the
      // last message row's box.
      await expect(page2.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 60_000 });
      const rowsAtAppear = await lastRowBox(page2);
      expect(rowsAtAppear).not.toBeNull();

      // X6: the pill survives the stall rather than flickering out mid-transfer.
      await page2.waitForTimeout(2_500);
      await expect(pill).toBeVisible();

      // The terminal batch lands → the flag clears → the pill goes.
      await expect(pill).toHaveCount(0, { timeout: 60_000 });
      await expect(page2.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 60_000 });

      // F11 (disappear): still the same box — the pill never occupied flow.
      const rowsAtClear = await lastRowBox(page2);
      expect(rowsAtClear?.x).toBeCloseTo(rowsAtAppear?.x as number, 0);
      expect(rowsAtClear?.width).toBeCloseTo(rowsAtAppear?.width as number, 0);
    } finally {
      await ctx2.close();
    }
  });

  test("F10 a warm reload taking the empty-delta path never paints the pill", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();

    await card.click();
    await sendPrompt(page, "[[faux:plain-text]] go");
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 45_000 });

    // Let the debounced replay-cache writer (1s) flush maxSeq to IndexedDB, so
    // the post-reload subscribe carries a cursor and the delta is empty.
    await page.waitForTimeout(1_800);

    // Sample continuously across the reload rather than only at the end.
    let everSeen = false;
    const poll = setInterval(async () => {
      try {
        if ((await page.locator(`[data-testid="${PILL}"]`).count()) > 0) everSeen = true;
      } catch {
        // Page navigating — ignore.
      }
    }, 100);

    try {
      await page.reload();
      await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
      await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 45_000 });
      await page.waitForTimeout(2_000);
    } finally {
      clearInterval(poll);
    }

    expect(everSeen).toBe(false);
    await expect(page.locator(`[data-testid="${PILL}"]`)).toHaveCount(0);
  });
});

/**
 * Bounding box of the last rendered assistant text row. The transcript has no
 * per-row testid, so the faux reply marker is the row handle.
 */
async function lastRowBox(page: Page) {
  const rows = page.getByText(PLAIN_TEXT_MARKER);
  if ((await rows.count()) === 0) return null;
  return await rows.last().boundingBox();
}

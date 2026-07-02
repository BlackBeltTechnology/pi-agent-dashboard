import { expect, type WebSocket as PWWebSocket, test } from "@playwright/test";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

const PLAIN_TEXT_MARKER = "The quick brown faux jumps over the lazy dog.";

// Strategy A (reduce-session-replay-traffic): a reload of an already-seen
// session resubscribes with a NON-ZERO lastSeq (delta replay), not lastSeq:0
// (full replay). We prove it at the wire: capture the `subscribe` frame the
// client sends over /ws after reload and assert its lastSeq > 0.
//
// The durable replay cursor lives in IndexedDB, which survives page.reload()
// within the same browser context — so the post-reload subscribe rehydrates the
// persisted maxSeq instead of starting from 0.

interface SubscribeFrame {
  type: string;
  sessionId?: string;
  lastSeq?: number;
}

function parseSubscribe(payload: string): SubscribeFrame | null {
  try {
    const msg = JSON.parse(payload) as SubscribeFrame;
    return msg.type === "subscribe" ? msg : null;
  } catch {
    return null;
  }
}

test.describe("Strategy A — delta replay on reload", () => {
  test("reload of a seen session resubscribes with lastSeq > 0", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();

    await card.click();
    // Drive a faux round-trip so the session accrues events (maxSeq > 0).
    await sendPrompt(page, "[[faux:plain-text]] go");
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 30_000 });

    // Let the debounced replay-cache writer (1s) flush maxSeq to IndexedDB.
    await page.waitForTimeout(1_800);

    // Capture every `subscribe` frame sent on any WS opened from now on. The
    // reload tears down the current socket and opens a fresh one; the handler
    // is registered BEFORE reload so the post-reload subscribe is captured.
    const subscribes: SubscribeFrame[] = [];
    page.on("websocket", (ws: PWWebSocket) => {
      ws.on("framesent", (frame) => {
        const payload = typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf8");
        const sub = parseSubscribe(payload);
        if (sub) subscribes.push(sub);
      });
    });

    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });

    // The post-reload subscribe for THIS session must carry a non-zero cursor.
    await expect
      .poll(
        () => {
          const forSession = subscribes.filter((s) => s.sessionId === sessionId);
          // True only once a subscribe with lastSeq > 0 has been observed AND
          // no lastSeq:0 (full replay) was sent for this session post-reload.
          return forSession.length > 0 && forSession.every((s) => (s.lastSeq ?? 0) > 0);
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    // Chat still painted after reload (rehydrated provisional state).
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 30_000 });
  });
});

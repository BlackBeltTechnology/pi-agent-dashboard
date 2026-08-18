import { expect, type Page, type WebSocket as PWWebSocket, test } from "./fixtures.js";
import {
  byTestId,
  sendPrompt,
  setSubagentTickThrottle,
  spawnFreshGitSession,
} from "./helpers/index.js";

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
  // Also the happy-path regression for purge-replay-cache-on-reset-paths
  // (test-plan #F7): server-scoped entries must not break the existing delta
  // optimization for a normal single-server session.
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

  // --- change: fix-replay-cache-partial-payload-cursor ---

  test("a broadcast-only session recovers its full history after reload (test-plan #F1)", async ({ page }) => {
    // Session B: spawned, then driven WITHOUT ever being opened in this tab.
    const cardB = await spawnFreshGitSession(page);
    const sessionB = await cardB.getAttribute("data-session-id");
    expect(sessionB).toBeTruthy();

    // Session A is the one this tab actually opens and subscribes to.
    const cardA = await spawnFreshGitSession(page);
    await cardA.click();

    // Drive B over REST so its events reach this tab ONLY via broadcast
    // fan-out (browser-gateway broadcasts to every socket, subscribed or not).
    await promptViaRest(page, sessionB as string, "[[faux:plain-text]] go");

    // Wait past the 1 s persist debounce so any (poisoned) cursor is written.
    await page.waitForTimeout(3_000);

    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });

    // Opening B must converge on its FULL transcript. Pre-fix, the broadcast-
    // only buffer had persisted `{maxSeq: <high>, payload: [1 stray row]}`, so
    // the delta subscribe skipped every earlier event and B rendered one row.
    await openSession(page, sessionB as string);
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 30_000 });
  });

  // --- change: purge-replay-cache-on-reset-paths ---

  test("chat refresh then reload does not resurrect the pre-refresh view (purge-replay-cache test-plan #F1)", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();

    await card.click();
    await sendPrompt(page, "[[faux:plain-text]] go");
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 30_000 });

    // Let the 1 s debounced writer persist a real entry (maxSeq > 0), so the
    // pre-refresh state IS durably cached — otherwise the test proves nothing.
    await page.waitForTimeout(1_800);

    const subscribes: SubscribeFrame[] = [];
    page.on("websocket", (ws: PWWebSocket) => {
      ws.on("framesent", (frame) => {
        const payload = typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf8");
        const sub = parseSubscribe(payload);
        if (sub) subscribes.push(sub);
      });
    });

    // PROVE the durable entry exists before refreshing it away. Without this,
    // the whole test is vacuous: if the write never landed, the post-refresh
    // subscribe would carry `lastSeq: 0` for the trivial reason that there was
    // never anything to purge, and the assertion below would pass regardless.
    // A delta subscribe (lastSeq > 0) is only reachable from a cache hit.
    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
    await openSession(page, sessionId as string);
    await expect
      .poll(
        () => subscribes.filter((s) => s.sessionId === sessionId).some((s) => (s.lastSeq ?? 0) > 0),
        { timeout: 30_000 },
      )
      .toBe(true);

    // Only frames from here on describe the POST-refresh subscribe.
    subscribes.length = 0;

    // Refresh Chat, then reload BEFORE the next 1 s debounce could re-persist.
    // The short settle lets the awaited durable delete land; it stays well under
    // the debounce so nothing is written back.
    await byTestId(page, "refreshChat").click();
    await page.waitForTimeout(300);
    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
    await openSession(page, sessionId as string);

    // The refresh must have reached the DURABLE layer: with the entry gone, the
    // post-reload subscribe is a FULL replay. A surviving entry would instead
    // rehydrate at its maxSeq and delta-replay onto the stale base.
    await expect
      .poll(
        () => {
          const forSession = subscribes.filter((s) => s.sessionId === sessionId);
          return forSession.length > 0 && forSession.every((s) => (s.lastSeq ?? 0) === 0);
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    // And the server's transcript still renders (refresh is not data loss).
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 30_000 });
  });

  test("a poisoned pre-change entry self-heals on upgrade (test-plan #F2)", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();

    await card.click();
    await sendPrompt(page, "[[faux:plain-text]] go");
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 30_000 });

    // Plant the exact field-poisoned shape a pre-change client would have
    // written: schemaVersion 1, a high cursor, a single stray row.
    await seedPoisonedV1Entry(page, sessionId as string);

    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
    await openSession(page, sessionId as string);

    // The schema bump purges the v1 entry on first read → full replay, no user
    // storage clearing.
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 30_000 });
  });
});

/** Click a session card by id, navigating to the dashboard first if needed. */
async function openSession(page: Page, sessionId: string): Promise<void> {
  const card = page.locator(`[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`);
  await card.waitFor({ state: "visible", timeout: 30_000 });
  await card.click();
}

/**
 * Send a prompt to a session through the dashboard's OWN same-origin REST, so
 * the tab never subscribes to it. Same page-context `fetch` pattern the git
 * helpers use (localhost-gated, no auth header).
 */
async function promptViaRest(page: Page, sessionId: string, prompt: string): Promise<void> {
  const res = await page.evaluate(
    async ([id, text]) => {
      const r = await fetch(`/api/session/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      return { status: r.status };
    },
    [sessionId, prompt] as const,
  );
  expect(res.status).toBeLessThan(400);
}

/** Write a pre-change (schemaVersion 1) partial-payload entry into IndexedDB. */
async function seedPoisonedV1Entry(page: Page, sessionId: string): Promise<void> {
  await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("pi-dashboard-replay-cache", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("sessions")) {
          req.result.createObjectStore("sessions", { keyPath: "sessionId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("sessions", "readwrite");
      tx.objectStore("sessions").put({
        sessionId: id,
        schemaVersion: 1,
        maxSeq: 9_999,
        payload: [
          {
            seq: 9_999,
            event: { sessionId: id, eventType: "message_end", timestamp: Date.now(), data: {} },
          },
        ],
        lastAccess: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, sessionId);
}

// ── Subagent tick throttle: replay-side rows (change: reduce-bridge-tick-bandwidth)
//
// This carrier's user-visible job is REPLAY, not liveness: it is what a mid-run
// page reload folds. So its staleness bound is asserted where it lives — on the
// events the SERVER stored — rather than on a reloaded DOM, which the ephemeral
// 250 ms carrier plus the resync refresh within milliseconds (a DOM sample would
// measure catch-up, not staleness).
test.describe("subagent tick throttle — replay", () => {
  const W = 500;

  // P3 (consecutive STORED Agent ticks within one window) moved to
  // tests/e2e/subagent-tick-throttle.spec.ts: it needs the synthetic Agent-tick
  // producer (PI_SYNTH_AGENT_TICKS=1 arm) to sustain a stored tick stream.
  // See change: reduce-bridge-tick-bandwidth.

  test("F3: a reload of a finished subagent run folds to the terminal snapshot", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/");
    await setSubagentTickThrottle(page, W);

    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});
    await sendPrompt(page, "[[faux:subagent-sustained]] go");
    await expect(page.getByText(/sustained subagent complete/i).first()).toBeVisible({
      timeout: 150_000,
    });

    // The terminal snapshot arrives on the SIBLING carrier (progress.flush) and
    // via tool_execution_end's result.details — never on the throttled carrier —
    // so a held-and-discarded tick must not change what a reload renders.
    const beforeRows = await page.locator("[data-index]").count();

    await page.reload();
    await expect(page.getByText(/sustained subagent complete/i).first()).toBeVisible({
      timeout: 60_000,
    });
    await page.waitForTimeout(2_000);
    const afterRows = await page.locator("[data-index]").count();

    expect(afterRows, "reload renders the same terminal entry count").toBe(beforeRows);
    // And the finished tool row never re-enters a running/partial render.
    await expect(page.getByText(/sustained subagent complete/i).first()).toBeVisible();
  });
});

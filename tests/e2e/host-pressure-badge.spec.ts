/**
 * L3 — test-plan #F3 and #F4 for change: fix-false-unresponsive-badge.
 *
 * The bug this change fixes was invisible at L1: every unit was green while
 * EVERY live card on screen read `unresponsive · ~24m`, because the verdict was
 * derived in the browser from a `processMetrics.updatedAt` that arrives once in
 * the connect snapshot and then freezes. Only a rendered-UI scenario over the
 * real socket can prove the replacement: the server raises the verdict, pushes
 * it as a `session_updated` transition, and the card acquires then loses the
 * pill with no page reload (#F3) — and a browser that connects DURING the
 * pressure gets the same state from `sessions_snapshot` (#F4).
 *
 * Silence is provoked by driving a synthetic bridge straight at the pi gateway
 * and then saying nothing: a real harness session heartbeats every 15 s and can
 * never go quiet on demand. Its cwd is borrowed from a real spawned session so
 * the card lands in an already-visible folder group.
 *
 * Exemplar for the raw-gateway glue: `bridge-contention-health.spec.ts`.
 * The dashboard port comes from `.pi-test-harness.json#dashboardPort` via the
 * fixtures' baseURL — never hardcoded.
 */

import { expect, type Page, test } from "./fixtures.js";
import { gatewayUrlWithTicket, pairDeviceBearer } from "./helpers/bridge-credential.js";
import { spawnFreshGitSession } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

/** Server thresholds (`packages/shared/src/host-pressure.ts`). */
const DEGRADED_MS = 35_000;
const UNRESPONSIVE_MS = 60_000;

async function piGatewayPort(page: Page): Promise<number | null> {
  const body = (await (await page.request.get("/api/health")).json()) as { piGatewayPort?: number | null };
  return body.piGatewayPort ?? null;
}

/**
 * A synthetic bridge socket. Registers one session id and then does exactly
 * what the test tells it to — the only way to make a bridge go quiet.
 */
async function connectBridge(port: number, bearer: string): Promise<WebSocket> {
  const url = await gatewayUrlWithTicket(BASE_URL, port, bearer);
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("open timeout")), 5000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(ws); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("socket error")); }, { once: true });
  });
}

/** The pill's rendered verdict for a session, or null when it renders nothing. */
async function badgeState(page: Page, sessionId: string): Promise<string | null> {
  const pill = page.locator(`[data-testid="session-host-pressure-${sessionId}"]`);
  if ((await pill.count()) === 0) return null;
  return pill.first().getAttribute("data-host-pressure");
}

test.describe("host-pressure badge over the real socket (L3)", () => {
  test("F3: a quiet bridge raises the pill, and a frame clears it — no page reload", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/");

    const port = await piGatewayPort(page);
    test.skip(!port, "harness health does not expose the bound gateway port");

    // Borrow a real session's cwd so the synthetic card renders in a visible
    // folder group rather than an unknown directory.
    const realCard = await spawnFreshGitSession(page);
    const realId = await realCard.getAttribute("data-session-id");
    const sessions = (await (await page.request.get("/api/sessions")).json()) as
      | { sessions?: Array<{ id: string; cwd: string }> }
      | Array<{ id: string; cwd: string }>;
    const rows = Array.isArray(sessions) ? sessions : (sessions.sessions ?? []);
    const cwd = rows.find((s) => s.id === realId)?.cwd;
    expect(cwd, "the spawned session reports a cwd").toBeTruthy();

    const sessionId = `e2e-pressure-${Date.now()}`;
    const bearer = await pairDeviceBearer(BASE_URL);
    const bridge = await connectBridge(port as number, bearer);
    bridge.send(JSON.stringify({ type: "session_register", sessionId, cwd, source: "tui", pid: 424242 }));

    try {
      // The card exists and is SILENT while the bridge is fresh — the
      // zero-pixel contract, and the non-vacuity guard for the pill below.
      const card = page.locator(`[data-session-id="${sessionId}"]`);
      await expect(card.first()).toBeVisible({ timeout: 30_000 });
      expect(await badgeState(page, sessionId)).toBeNull();

      // Now it says nothing at all. The verdict is PUSHED, so the pill must
      // appear without any navigation.
      await expect
        .poll(() => badgeState(page, sessionId), {
          timeout: UNRESPONSIVE_MS + 60_000,
          intervals: [2_000],
        })
        .toBe("unresponsive");

      // A single frame proves the loop runs again → explicit clear → the pill
      // goes away, still with no reload.
      bridge.send(JSON.stringify({ type: "session_heartbeat", sessionId }));
      await expect
        .poll(() => badgeState(page, sessionId), { timeout: 30_000, intervals: [1_000] })
        .toBeNull();
    } finally {
      bridge.send(JSON.stringify({ type: "session_unregister", sessionId }));
      bridge.close();
    }
  });

  test("F4: a browser that connects DURING the pressure sees the same badge", async ({ page, browser }) => {
    test.setTimeout(240_000);
    await page.goto("/");

    const port = await piGatewayPort(page);
    test.skip(!port, "harness health does not expose the bound gateway port");

    const realCard = await spawnFreshGitSession(page);
    const realId = await realCard.getAttribute("data-session-id");
    const sessions = (await (await page.request.get("/api/sessions")).json()) as
      | { sessions?: Array<{ id: string; cwd: string }> }
      | Array<{ id: string; cwd: string }>;
    const rows = Array.isArray(sessions) ? sessions : (sessions.sessions ?? []);
    const cwd = rows.find((s) => s.id === realId)?.cwd;

    const sessionId = `e2e-pressure-snap-${Date.now()}`;
    const bearer = await pairDeviceBearer(BASE_URL);
    const bridge = await connectBridge(port as number, bearer);
    bridge.send(JSON.stringify({ type: "session_register", sessionId, cwd, source: "tui", pid: 424243 }));

    const second = await browser.newContext({ baseURL: BASE_URL });
    try {
      // First browser watches the raise happen live (`session_updated`).
      await expect
        .poll(() => badgeState(page, sessionId), {
          timeout: DEGRADED_MS + 60_000,
          intervals: [2_000],
        })
        .not.toBeNull();
      const live = await badgeState(page, sessionId);

      // Second browser learns the SAME state from `sessions_snapshot` alone —
      // it was never on the wire for the transition.
      const late = await second.newPage();
      await late.goto("/");
      await expect
        .poll(() => badgeState(late, sessionId), { timeout: 60_000, intervals: [2_000] })
        .not.toBeNull();

      // Compared at the same instant: the local ticker may have escalated both
      // by now, but it must have escalated them identically.
      expect(await badgeState(late, sessionId)).toBe(await badgeState(page, sessionId));
      expect(["degraded", "unresponsive"]).toContain(live);
    } finally {
      bridge.send(JSON.stringify({ type: "session_unregister", sessionId }));
      bridge.close();
      await second.close();
    }
  });
});

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
 * Silence is provoked by driving a SYNTHETIC bridge straight at the pi gateway
 * and then saying nothing: a real harness session heartbeats every 15 s and can
 * never go quiet on demand. No `spawnFreshGitSession` here — the scenario needs
 * a quiet bridge, not a live model, and a real spawn would only add a minute of
 * latency and a reap obligation. It registers under `FIXTURE_GIT`, the
 * pre-trusted fixture the sidebar already groups by.
 *
 * Exemplar for the raw-gateway glue: `bridge-contention-health.spec.ts`.
 * The dashboard port comes from `.pi-test-harness.json#dashboardPort` via the
 * fixtures' baseURL — never hardcoded.
 */

import { expect, type Page, test } from "./fixtures.js";
import { gatewayUrlWithTicket, pairDeviceBearer } from "./helpers/bridge-credential.js";
import { FIXTURE_GIT, pinDirectory } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

/** Server thresholds (`packages/shared/src/host-pressure.ts`). */
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

/** Best-effort send: a dead socket in cleanup must not mask the real failure. */
function trySend(bridge: WebSocket, payload: unknown): void {
  try {
    if (bridge.readyState === WebSocket.OPEN) bridge.send(JSON.stringify(payload));
  } catch {
    // The socket died with the test; nothing left to clean up on it.
  }
}

/** The pill's rendered verdict for a session, or null when it renders nothing. */
async function badgeState(page: Page, sessionId: string): Promise<string | null> {
  const pill = page.locator(`[data-testid="session-host-pressure-${sessionId}"]`);
  if ((await pill.count()) === 0) return null;
  return pill.first().getAttribute("data-host-pressure");
}

/**
 * Wait for the synthetic card to render. On a container whose sidebar has no
 * group for the fixture yet, pin it once and wait again — the card exists on
 * the server either way, so this is a rendering precondition, not the assertion.
 */
async function awaitCard(page: Page, sessionId: string): Promise<void> {
  const card = page.locator(`[data-session-id="${sessionId}"]`).first();
  const shown = await card
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (shown) return;
  await pinDirectory(page, FIXTURE_GIT);
  await expect(card).toBeVisible({ timeout: 30_000 });
}

test.describe("host-pressure badge over the real socket (L3)", () => {
  test("F3: a quiet bridge raises the pill, and a frame clears it — no page reload", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/");

    const port = await piGatewayPort(page);
    test.skip(!port, "harness health does not expose the bound gateway port");

    const sessionId = `e2e-pressure-${Date.now()}`;
    const bearer = await pairDeviceBearer(BASE_URL);
    const bridge = await connectBridge(port as number, bearer);
    bridge.send(
      JSON.stringify({ type: "session_register", sessionId, cwd: FIXTURE_GIT, source: "tui", pid: 424242 }),
    );

    try {
      // The card exists and is SILENT while the bridge is fresh — the
      // zero-pixel contract, and the non-vacuity guard for the pill below.
      // `awaitCard` may legitimately spend longer than the 35 s degraded
      // threshold (it can pin a folder), so re-arm the window immediately
      // before asserting silence: otherwise a slow harness fails this line
      // with no product bug behind it.
      await awaitCard(page, sessionId);
      bridge.send(JSON.stringify({ type: "session_heartbeat", sessionId }));
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
      trySend(bridge, { type: "session_unregister", sessionId });
      bridge.close();
    }
  });

  test("F4: a browser that connects DURING the pressure sees the same badge", async ({ page, browser }) => {
    test.setTimeout(240_000);
    await page.goto("/");

    const port = await piGatewayPort(page);
    test.skip(!port, "harness health does not expose the bound gateway port");

    const sessionId = `e2e-pressure-snap-${Date.now()}`;
    const bearer = await pairDeviceBearer(BASE_URL);
    const bridge = await connectBridge(port as number, bearer);
    bridge.send(
      JSON.stringify({ type: "session_register", sessionId, cwd: FIXTURE_GIT, source: "tui", pid: 424243 }),
    );

    const second = await browser.newContext({ baseURL: BASE_URL });
    try {
      // First browser watches the raise happen live (`session_updated`).
      // Settled at the TERMINAL state, not merely "some verdict": the two
      // contexts tick on independent 5 s phases, so comparing them mid-
      // escalation would fail for up to one tick with nothing wrong.
      await awaitCard(page, sessionId);
      await expect
        .poll(() => badgeState(page, sessionId), {
          timeout: UNRESPONSIVE_MS + 60_000,
          intervals: [2_000],
        })
        .toBe("unresponsive");

      // Second browser learns the SAME state from `sessions_snapshot` alone —
      // it was never on the wire for the transition.
      const late = await second.newPage();
      await late.goto("/");
      await expect
        .poll(() => badgeState(late, sessionId), { timeout: 60_000, intervals: [2_000] })
        .toBe("unresponsive");

      // Both settled; the snapshot path and the live path agree.
      expect(await badgeState(page, sessionId)).toBe("unresponsive");
    } finally {
      trySend(bridge, { type: "session_unregister", sessionId });
      bridge.close();
      await second.close();
    }
  });
});

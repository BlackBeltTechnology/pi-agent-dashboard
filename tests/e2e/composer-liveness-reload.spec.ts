import { expect, type Page, test } from "./fixtures.js";
import { gatewayUrlWithTicket, pairDeviceBearer } from "./helpers/bridge-credential.js";
import { FIXTURE_GIT, gotoDashboard, pinDirectory, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * Browser E2E — composer liveness survives a browser reload (L3).
 *
 * After a reload the chat reducer only sees replayed events; when the run's
 * `agent_start` is not re-delivered it stays `idle` while the server still holds
 * `streaming`. The composer must show Stop anyway (reconciled liveness:
 * server `DashboardSession.status` is authoritative once known).
 *
 * The "server knows, browser doesn't" state is produced by driving the bridge
 * socket directly: ticketed register, then `session_heartbeat{agentRunning:true}`
 * with NO `agent_start` — the server reconciles `active → streaming` while the
 * reducer stays `idle`. Same primitive as `streaming-latch-heal.spec.ts`.
 * Gateway port from `/api/health`; dashboard port never hardcoded.
 *
 * See change: fix-composer-liveness-on-reload (test-plan #F1–#F11, #X1, #X2).
 */

interface Bridge {
  sessionId: string;
  received: Array<Record<string, unknown>>;
  send: (payload: Record<string, unknown>) => void;
  close: () => void;
}

async function piGatewayPort(page: Page): Promise<number | null> {
  const body = (await (await page.request.get("/api/health")).json()) as { piGatewayPort?: number | null };
  return body.piGatewayPort ?? null;
}

async function connectBridge(page: Page, tag: string): Promise<Bridge> {
  const port = await piGatewayPort(page);
  test.skip(!port, "harness health does not expose the bound gateway port");
  const bearer = await pairDeviceBearer(BASE_URL);
  const url = await gatewayUrlWithTicket(BASE_URL, port as number, bearer);
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const s = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("open timeout")), 5000);
    s.addEventListener("open", () => { clearTimeout(timer); resolve(s); }, { once: true });
    s.addEventListener("error", () => { clearTimeout(timer); reject(new Error("socket error")); }, { once: true });
  });
  const sessionId = `e2e-liveness-${tag}-${Date.now()}`;
  const received: Array<Record<string, unknown>> = [];
  ws.addEventListener("message", (ev) => {
    try { received.push(JSON.parse(String(ev.data))); } catch { /* non-JSON */ }
  });
  const send = (payload: Record<string, unknown>) => {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    } catch {
      // socket died with the test
    }
  };
  send({ type: "session_register", sessionId, cwd: FIXTURE_GIT, source: "tui", pid: 425000 + Math.floor(Math.random() * 999) });
  send({ type: "replay_complete", sessionId });
  return { sessionId, received, send, close: () => { try { ws.close(); } catch { /* closed */ } } };
}

async function ensurePinned(page: Page): Promise<void> {
  const res = await page.request.get("/api/pinned-dirs");
  const body = (await res.json()) as { data?: string[] };
  if (!(body.data ?? []).includes(FIXTURE_GIT)) await pinDirectory(page, FIXTURE_GIT);
}

const cardOf = (page: Page, sessionId: string) => page.locator(`[data-session-id="${sessionId}"]`).first();

async function openSession(page: Page, sessionId: string): Promise<void> {
  const card = cardOf(page, sessionId);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(page.getByTestId("composer-card")).toBeVisible({ timeout: 20_000 });
}

const beat = (b: Bridge, agentRunning: boolean) => b.send({ type: "session_heartbeat", sessionId: b.sessionId, agentRunning });
const agentStart = (b: Bridge) =>
  b.send({ type: "event_forward", sessionId: b.sessionId, event: { eventType: "agent_start", timestamp: Date.now(), data: {} } });
const stopBtn = (page: Page) => page.getByTestId("stop-button");
const sendBtn = (page: Page) => page.getByTestId("send-button");

/** F1 state: server `streaming` (heartbeat), reducer `idle` (no agent_start), browser reloaded. */
async function reloadMidRun(page: Page, b: Bridge): Promise<void> {
  await gotoDashboard(page);
  await ensurePinned(page);
  await expect(cardOf(page, b.sessionId)).toBeVisible({ timeout: 30_000 });
  beat(b, true);
  await expect(cardOf(page, b.sessionId).getByTestId("session-status-icon")).toHaveAttribute("data-status-shape", "working", { timeout: 30_000 });
  await page.reload();
  await openSession(page, b.sessionId);
}

/**
 * Toggle the process-wide shed injector (`PI_E2E_FORCE_SHED=1`, see
 * `status-reconcile.spec.ts`). Asserting the reported state proves the flag reached
 * the server, so a harness booted without it cannot turn X1 into a silent no-op.
 */
async function setForceShed(page: Page, enabled: boolean): Promise<void> {
  const body = await page.evaluate(async (on) => {
    const res = await fetch("/api/test/force-shed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: on }),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }, enabled);
  expect(body.status, "force-shed route must exist (PI_E2E_FORCE_SHED=1)").toBe(200);
  expect(body.json?.data?.forceShed).toBe(enabled);
}

test.describe("composer liveness after reload (L3)", () => {
  // The injector is process-wide: never leave it on, even when a test fails.
  test.afterEach(async ({ page }) => {
    await setForceShed(page, false).catch(() => {});
  });

  test("F1/F2/F10/F11: reload mid-run shows Stop; transcript is not fabricated; Stop and stop-after-turn reach the bridge", async ({ page }) => {
    await gotoDashboard(page);
    await ensurePinned(page);
    const b = await connectBridge(page, "f1");
    const frames: string[] = [];
    page.on("websocket", (ws) => ws.on("framereceived", (f) => { frames.push(String(f.payload)); }));
    try {
      await reloadMidRun(page, b);
      // F1: card, composer and the toolbar status word agree.
      await expect(cardOf(page, b.sessionId).getByTestId("session-status-icon")).toHaveAttribute("data-status-shape", "working");
      await expect(stopBtn(page)).toBeVisible({ timeout: 20_000 });
      await expect(sendBtn(page)).toHaveCount(0);
      await expect(page.getByTestId("working-status")).toContainText(/Thinking/i);
      // F2: transcript stays event-sourced — no agent_start was ever sent, none received.
      expect(frames.some((f) => f.includes('"agent_start"'))).toBe(false);
      // F11: stop-after-turn is offered beside Stop and reaches the bridge.
      await page.getByTestId("stop-after-turn-button").click();
      await expect.poll(() => b.received.filter((m) => m.type === "stop_after_turn" && m.sessionId === b.sessionId).length, { timeout: 10_000 }).toBe(1);
      await expect(page.getByTestId("stop-after-turn-pill")).toBeVisible();
      // F10: Stop sends abort exactly once.
      await stopBtn(page).click();
      await expect.poll(() => b.received.filter((m) => m.type === "abort" && m.sessionId === b.sessionId).length, { timeout: 10_000 }).toBe(1);
    } finally {
      b.close();
    }
  });

  test("F3: submitting from a recovered run keeps the optimistic bubble and fabricates no assistant bubble", async ({ page }) => {
    await gotoDashboard(page);
    await ensurePinned(page);
    const b = await connectBridge(page, "f3");
    try {
      await reloadMidRun(page, b);
      await expect(stopBtn(page)).toBeVisible({ timeout: 20_000 });
      await page.getByTestId("composer-card").locator("textarea").fill("hello");
      await page.getByTestId("composer-card").locator("textarea").press("Enter");
      await expect(page.getByText("hello", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
      // The reconciliation must not clear the pending prompt (no synthetic agent_start).
      await page.waitForTimeout(1_500);
      await expect(page.getByText("hello", { exact: true }).first()).toBeVisible();
    } finally {
      b.close();
    }
  });

  test("F4: mobile viewport — info strip and Stop agree after reload", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDashboard(page);
    await ensurePinned(page);
    const b = await connectBridge(page, "f4");
    try {
      await reloadMidRun(page, b);
      await expect(page.getByText("Thinking...", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      await expect(stopBtn(page)).toBeVisible();
    } finally {
      b.close();
    }
  });

  test("F5: connected idle shows Send; a running heartbeat flips to Stop with no reload", async ({ page }) => {
    await gotoDashboard(page);
    await ensurePinned(page);
    const b = await connectBridge(page, "f5");
    try {
      await openSession(page, b.sessionId);
      await expect(sendBtn(page)).toBeVisible();
      await expect(stopBtn(page)).toHaveCount(0);
      beat(b, true);
      await expect(stopBtn(page)).toBeVisible({ timeout: 20_000 });
    } finally {
      b.close();
    }
  });

  test("F6: a latched Stop heals to Send on the next idle beat; card and composer agree", async ({ page }) => {
    await gotoDashboard(page);
    await ensurePinned(page);
    const b = await connectBridge(page, "f6");
    try {
      await openSession(page, b.sessionId);
      agentStart(b);
      await expect(stopBtn(page)).toBeVisible({ timeout: 20_000 });
      beat(b, false);
      await expect(sendBtn(page)).toBeVisible({ timeout: 20_000 });
      await expect(stopBtn(page)).toHaveCount(0);
      await expect(cardOf(page, b.sessionId).getByTestId("session-status-icon")).not.toHaveAttribute("data-status-shape", "working");
    } finally {
      b.close();
    }
  });

  test("F7: a dropped browser-bound agent_end still ends Stop (server idle wins over the latched reducer)", async ({ page }) => {
    await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => {
        if (typeof m === "string" && m.includes('"agent_end"')) return; // drop agent_end only
        ws.send(m);
      });
    });
    await gotoDashboard(page);
    await ensurePinned(page);
    const b = await connectBridge(page, "f7");
    try {
      await openSession(page, b.sessionId);
      agentStart(b);
      await expect(stopBtn(page)).toBeVisible({ timeout: 20_000 });
      b.send({ type: "event_forward", sessionId: b.sessionId, event: { eventType: "agent_end", timestamp: Date.now(), data: {} } });
      await expect(sendBtn(page)).toBeVisible({ timeout: 20_000 });
      await expect(stopBtn(page)).toHaveCount(0);
    } finally {
      b.close();
    }
  });

  test("F8: an ended session never shows Stop / Force-Stop / Killing after reload", async ({ page }) => {
    await gotoDashboard(page);
    await ensurePinned(page);
    const b = await connectBridge(page, "f8");
    try {
      await openSession(page, b.sessionId);
      agentStart(b);
      await expect(stopBtn(page)).toBeVisible({ timeout: 20_000 });
      b.send({ type: "session_unregister", sessionId: b.sessionId });
      await expect(stopBtn(page)).toHaveCount(0, { timeout: 20_000 });
      await page.reload();
      await expect(page.getByTestId("composer-card")).toBeVisible({ timeout: 30_000 });
      for (const id of ["stop-button", "force-stop-button", "killing-button"]) {
        await expect(page.getByTestId(id)).toHaveCount(0);
      }
    } finally {
      b.close();
    }
  });

  test("F9: a real run ends with Send and no lingering Stop", async ({ page }) => {
    await gotoDashboard(page);
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:plain-text]] hello");
    await expect(sendBtn(page)).toBeVisible({ timeout: 60_000 });
    await expect(stopBtn(page)).toHaveCount(0, { timeout: 30_000 });
  });

  test("X2: a closed bridge socket (no unregister) keeps Stop and the working card", async ({ page }) => {
    await gotoDashboard(page);
    await ensurePinned(page);
    const b = await connectBridge(page, "x2");
    try {
      await reloadMidRun(page, b);
      await expect(stopBtn(page)).toBeVisible({ timeout: 20_000 });
      b.close();
      await page.waitForTimeout(5_000);
      await expect(stopBtn(page)).toBeVisible();
      await expect(cardOf(page, b.sessionId).getByTestId("session-status-icon")).toHaveAttribute("data-status-shape", "working");
    } finally {
      b.close();
    }
  });

  test("X1: a shed status frame never leaves the composer stuck on Send after the socket drains", async ({ page }) => {
    await gotoDashboard(page);
    await ensurePinned(page);
    const b = await connectBridge(page, "x1");
    try {
      await openSession(page, b.sessionId);
      await expect(sendBtn(page)).toBeVisible();
      await setForceShed(page, true);
      beat(b, true); // server → streaming; its session_updated frame is shed
      await page.waitForTimeout(1_000);
      await setForceShed(page, false); // drain → server re-pushes the current state
      await expect(stopBtn(page)).toBeVisible({ timeout: 20_000 });
    } finally {
      b.close();
    }
  });
});

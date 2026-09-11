import { expect, test } from "./fixtures.js";
import { gatewayUrlWithTicket, pairDeviceBearer } from "./helpers/bridge-credential.js";
import { BASE_URL } from "./lifecycle.js";

// test-plan #F1 + #P2 (L3) — change: fix-stuck-streaming-status-latch.
//
// `status: "streaming"` is a one-way latch: `agent_end` is the only path back
// to `idle`, so one dropped `agent_end` sticks a card on `Thinking…` until a
// restart. The heartbeat now carries `agentRunning`, and the server reconciles
// against it — so the card must self-heal in the RENDERED UI, with no reload
// and no session restart.
//
// The loss is induced by driving the bridge socket directly (register a
// synthetic session, send `agent_start`, never send `agent_end`) rather than
// intercepting a real pi turn: the dashboard has no "drop this event"
// affordance. The gateway port comes from `/api/health` — never hardcoded.

async function connectBridge(piPort: number, bearer: string): Promise<WebSocket> {
  const url = await gatewayUrlWithTicket(BASE_URL, piPort, bearer);
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("open timeout")), 5000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(ws); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("socket error")); }, { once: true });
  });
}

test.describe("stuck streaming latch heals in the UI (L3)", () => {
  test("F1/P2: a latched card leaves Thinking… on the next liveness beat", async ({ page, request }) => {
    const healthRes = await request.get("/api/health");
    expect(healthRes.ok()).toBeTruthy();
    const piPort = ((await healthRes.json()) as { piGatewayPort?: number | null }).piGatewayPort;
    test.skip(!piPort, "harness health does not expose the bound gateway port");

    const sessionId = `e2e-latch-${Date.now()}`;
    const bearer = await pairDeviceBearer(BASE_URL);
    const ws = await connectBridge(piPort!, bearer);

    ws.send(JSON.stringify({
      type: "session_register",
      sessionId,
      cwd: "/tmp/e2e-latch",
      source: "tui",
      pid: 987654,
    }));
    // Leave the replay window so live events are broadcast, exactly as a real
    // bridge does after it finishes replaying history.
    ws.send(JSON.stringify({ type: "replay_complete", sessionId }));

    await page.goto("/");
    const card = page.locator(`[data-session-id="${sessionId}"]`).first();
    await expect(card).toBeVisible({ timeout: 30_000 });

    // Latch it: the turn starts, and its `agent_end` is lost in transport.
    ws.send(JSON.stringify({
      type: "event_forward",
      sessionId,
      event: { eventType: "agent_start", timestamp: Date.now(), data: {} },
    }));
    await expect(card).toContainText(/Thinking/i, { timeout: 30_000 });

    // The next periodic beat carries the bridge's real liveness.
    const beatAt = Date.now();
    ws.send(JSON.stringify({ type: "session_heartbeat", sessionId, agentRunning: false }));

    // #F1: converges to the idle rendering with no reload and no restart.
    // #P2: within HEARTBEAT_INTERVAL (15 s) + 5 s slack of the first beat.
    await expect(card).not.toContainText(/Thinking/i, { timeout: 20_000 });
    expect(Date.now() - beatAt).toBeLessThan(20_000);
    await expect(card).toContainText(/Idle/i, { timeout: 5_000 });

    ws.close();
  });
});

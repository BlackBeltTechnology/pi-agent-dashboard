import { expect, test } from "./fixtures.js";
import { gatewayUrlWithTicket, pairDeviceBearer } from "./helpers/bridge-credential.js";
import { BASE_URL } from "./lifecycle.js";

// test-plan #F6 (L3) — change: fix-duplicate-bridge-registration (D6).
//
// A refusal must become visible on the operator surface and then go away on its
// own, with no stuck badge. The dashboard polls `/api/health`, so that payload
// is the observable: `bridgeContentionCount` is cumulative for the process
// lifetime and `contendedSessionIds` follows the contention record's lifecycle
// (reclaim, 60 s expiry, incumbent disconnect, or session end).
//
// The refusal is provoked over the pi gateway from inside the harness: two
// sockets claim one session id, the newcomer loses. The dashboard port comes
// from `.pi-test-harness.json#dashboardPort` via the fixtures' baseURL — never
// hardcoded.

interface HealthBody {
  activeBridgeCount?: number;
  bridgeContentionCount?: number;
  contendedSessionIds?: string[];
  piGatewayPort?: number | null;
}

async function health(
  request: import("@playwright/test").APIRequestContext,
): Promise<HealthBody> {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as HealthBody;
}

test.describe("bridge contention health surface (L3)", () => {
  test("the health payload exposes the contention counters", async ({ request }) => {
    const body = await health(request);

    // The fields the dashboard polls must exist and be well-typed even when
    // nothing has ever been refused — a missing field is a stuck-badge source.
    expect(body.bridgeContentionCount, "bridgeContentionCount is exposed").toBeGreaterThanOrEqual(0);
    expect(Array.isArray(body.contendedSessionIds), "contendedSessionIds is a list").toBe(true);
  });

  test("a refused duplicate register appears in the health payload", async ({ request }) => {
    const before = await health(request);
    const piPort = before.piGatewayPort;
    test.skip(!piPort, "harness health does not expose the bound gateway port");

    const sessionId = `e2e-contention-${Date.now()}`;

    // Drive two claims for one id straight at the pi gateway. Uses the Node
    // global `WebSocket` rather than the `ws` package: `ws` is only a hoisted
    // transitive dependency here, not one this workspace declares.
    // A ticket per connection: this spec runs on the HOST, so the gateway
    // sees the docker bridge address rather than loopback and requires a
    // bridge-scoped credential. Tickets are single-use — mint inside connect().
    const bearer = await pairDeviceBearer(BASE_URL);
    const connect = async (port: number): Promise<WebSocket> => {
      const url = await gatewayUrlWithTicket(BASE_URL, port, bearer);
      return new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(url);
        // Cleared on settle: a live 5 s timer per connection would otherwise
        // hold the test worker open past the assertions.
        const timer = setTimeout(() => reject(new Error("open timeout")), 5000);
        ws.addEventListener("open", () => { clearTimeout(timer); resolve(ws); }, { once: true });
        ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("socket error")); }, { once: true });
      });
    };

    const register = (ws: WebSocket, pid: number) =>
      ws.send(
        JSON.stringify({
          type: "session_register",
          sessionId,
          cwd: "/tmp/e2e-contention",
          source: "tui",
          pid,
        }),
      );

    const incumbent = await connect(piPort!);
    register(incumbent, 111111);
    await new Promise((r) => setTimeout(r, 500));

    const duplicate = await connect(piPort!);
    const closed = new Promise<void>((r) => duplicate.addEventListener("close", () => r()));
    register(duplicate, 222222);
    await closed;

    // The contended id surfaces on the payload the dashboard polls …
    await expect
      .poll(async () => (await health(request)).contendedSessionIds ?? [], { timeout: 15_000 })
      .toContain(sessionId);

    const during = await health(request);
    expect(during.bridgeContentionCount!).toBeGreaterThan(before.bridgeContentionCount ?? 0);

    // … and clears when the incumbent disconnects, leaving no stuck badge.
    incumbent.close();
    await expect
      .poll(async () => (await health(request)).contendedSessionIds ?? [], { timeout: 15_000 })
      .not.toContain(sessionId);

    // The cumulative counter is NOT rolled back by the clear.
    const after = await health(request);
    expect(after.bridgeContentionCount!).toBeGreaterThanOrEqual(during.bridgeContentionCount!);
  });
});

// ── origin binding (change: harden-bridge-session-claim, test-plan BE70 / BF1) ─────────────────────────
//
// Two devices paired at `operate`. D1's session S is live; D2 (another origin) registers the same id and is
// refused terminally with the origin reason, before any probe. The refusal shows on the health payload the
// dashboard polls, then leaves it when S ends, with the cumulative count unchanged.
test.describe("bridge origin binding (L3)", () => {
  test("BE70/BF1: a second paired device cannot take another device's session id", async ({ request }) => {
    const before = await health(request);
    const piPort = before.piGatewayPort;
    test.skip(!piPort, "harness health does not expose the bound gateway port");
    const sessionId = `e2e-origin-${Date.now()}`;

    const d1 = await pairDeviceBearer(BASE_URL);
    const d2 = await pairDeviceBearer(BASE_URL);
    const connect = async (bearer: string): Promise<{ ws: WebSocket; frames: Array<Record<string, unknown>> }> => {
      const url = await gatewayUrlWithTicket(BASE_URL, piPort!, bearer);
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const frames: Array<Record<string, unknown>> = [];
        ws.addEventListener("message", (ev) => { try { frames.push(JSON.parse(String(ev.data))); } catch { /* ignore */ } });
        const timer = setTimeout(() => reject(new Error("open timeout")), 5000);
        ws.addEventListener("open", () => { clearTimeout(timer); resolve({ ws, frames }); }, { once: true });
        ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("socket error")); }, { once: true });
      });
    };
    const register = (ws: WebSocket, pid: number) =>
      ws.send(JSON.stringify({ type: "session_register", sessionId, cwd: "/tmp/e2e-origin", source: "tui", pid, sessionFile: `/tmp/${sessionId}.jsonl` }));

    const owner = await connect(d1);
    register(owner.ws, 111111);
    await new Promise((r) => setTimeout(r, 500));

    // Same pid on purpose: WS-02's displacement trick must not work across origins.
    const intruder = await connect(d2);
    const closed = new Promise<void>((r) => intruder.ws.addEventListener("close", () => r()));
    register(intruder.ws, 111111);
    await closed;
    const rejected = intruder.frames.find((f) => f.type === "register_rejected") as { reason?: string } | undefined;
    expect(rejected?.reason ?? "").toMatch(/another origin/);

    await expect.poll(async () => (await health(request)).contendedSessionIds ?? [], { timeout: 15_000 }).toContain(sessionId);
    const during = await health(request);
    expect(during.bridgeContentionCount!).toBeGreaterThan(before.bridgeContentionCount ?? 0);

    // The owner was not displaced: it still answers a heartbeat.
    owner.ws.send(JSON.stringify({ type: "session_heartbeat", sessionId }));
    await expect.poll(() => owner.frames.some((f) => f.type === "heartbeat_ack"), { timeout: 10_000 }).toBe(true);

    owner.ws.send(JSON.stringify({ type: "session_unregister", sessionId }));
    await expect.poll(async () => (await health(request)).contendedSessionIds ?? [], { timeout: 15_000 }).not.toContain(sessionId);
    expect((await health(request)).bridgeContentionCount!).toBeGreaterThanOrEqual(during.bridgeContentionCount!);
    owner.ws.close();
  });
});

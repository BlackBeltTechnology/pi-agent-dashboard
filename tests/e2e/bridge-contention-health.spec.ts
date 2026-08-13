import { expect, test } from "./fixtures.js";

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
    const connect = (port: number) =>
      new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        ws.addEventListener("open", () => resolve(ws));
        ws.addEventListener("error", () => reject(new Error("socket error")));
        setTimeout(() => reject(new Error("open timeout")), 5000);
      });

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

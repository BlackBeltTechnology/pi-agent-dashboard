import { expect, test } from "./fixtures.js";
import { sendPrompt, setSubagentTickThrottle, spawnFreshGitSession } from "./helpers/index.js";

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
        // Cleared on settle: a live 5 s timer per connection would otherwise
        // hold the test worker open past the assertions.
        const timer = setTimeout(() => reject(new Error("open timeout")), 5000);
        ws.addEventListener(
          "open",
          () => {
            clearTimeout(timer);
            resolve(ws);
          },
          { once: true },
        );
        ws.addEventListener(
          "error",
          () => {
            clearTimeout(timer);
            reject(new Error("socket error"));
          },
          { once: true },
        );
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

// ── D6 counter transport (change: reduce-bridge-tick-bandwidth) ─────────────
//
// The throttle's two information-loss modes (`tickDiscardedAtTerminal`,
// `tickDroppedNotReady`) are otherwise entirely invisible in production, and
// without a transport every counter assertion would be stuck at L1. The
// counters ride the existing heartbeat `processMetrics` transport, so they land
// on `/api/health` both summed (`subagentTickThrottle`) and per-session (spread
// into `agents[]`).
interface ThrottleCounters {
  tickForwarded: number;
  tickCoalesced: number;
  tickDiscardedAtTerminal: number;
  tickDroppedNotReady: number;
}

test.describe("subagent tick throttle — health counters (L3)", () => {
  test("X7: counters reach /api/health after a throttled subagent run", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/");
    await setSubagentTickThrottle(page, 500);

    const before = (await (await page.request.get("/api/health")).json()) as {
      subagentTickThrottle: ThrottleCounters;
      pid: number;
    };
    // The field exists and is well-typed even before anything ticked — a
    // missing field is exactly the stuck-zero an operator cannot distinguish
    // from a healthy quiet system.
    expect(Object.keys(before.subagentTickThrottle).sort()).toEqual([
      "tickCoalesced",
      "tickDiscardedAtTerminal",
      "tickDroppedNotReady",
      "tickForwarded",
    ]);

    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});
    await sendPrompt(page, "[[faux:subagent-streaming]] go");
    await expect(page.getByText(/streaming subagent complete/i).first()).toBeVisible({
      timeout: 150_000,
    });

    // Counters ride the heartbeat, so they arrive on its interval, not instantly.
    await expect
      .poll(
        async () => {
          const body = (await (await page.request.get("/api/health")).json()) as {
            agents: Array<{ sessionId: string } & Partial<ThrottleCounters>>;
          };
          return body.agents.find((a) => a.sessionId === sessionId)?.tickForwarded ?? 0;
        },
        { timeout: 60_000, intervals: [2_000] },
      )
      .toBeGreaterThan(0);

    const after = (await (await page.request.get("/api/health")).json()) as {
      subagentTickThrottle: ThrottleCounters;
      pid: number;
    };
    expect(after.subagentTickThrottle.tickForwarded).toBeGreaterThan(
      before.subagentTickThrottle.tickForwarded,
    );
    // A streaming subagent at ~50 events/s against a 500 ms window MUST have
    // coalesced; a zero here means the predicate never matched.
    expect(after.subagentTickThrottle.tickCoalesced).toBeGreaterThan(0);
    // Existing health fields unchanged by the additive block.
    expect(after.pid).toBe(before.pid);
  });

  test("X8: predicate tripwire — a non-subagent session moves no throttle counter", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await setSubagentTickThrottle(page, 500);

    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});
    // A run with NO subagent at all: only ordinary streaming tool output.
    await sendPrompt(page, "[[faux:burst-heterogeneous]] go");
    await page.waitForTimeout(15_000);

    const body = (await (await page.request.get("/api/health")).json()) as {
      agents: Array<{ sessionId: string } & Partial<ThrottleCounters>>;
    };
    const mine = body.agents.find((a) => a.sessionId === sessionId);
    expect(mine, "the session reported process metrics").toBeTruthy();
    // Asserted PER-SESSION, not on the summed block: the harness shares one
    // container, and a concurrent subagent run elsewhere would move the sum.
    expect(mine?.tickForwarded ?? 0, "a mis-scoped predicate shows up as movement here").toBe(0);
    expect(mine?.tickCoalesced ?? 0).toBe(0);
  });
});

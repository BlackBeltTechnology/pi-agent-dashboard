import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { gatewayUrlWithTicket, pairDeviceBearer } from "./helpers/bridge-credential.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * test-plan #F2/#F3/#F4/#F5 (L3) — change: fix-spawn-correlation-ttl-coupling.
 *
 * A late-registering spawn must converge on BOTH halves at once: the timeout
 * banner clears AND the card appears. The reported symptom was exactly half of
 * that — "banner clears itself, but no card appears until refresh".
 *
 * SEAM. `session_added.spawnRequestId` is keyed by the SERVER-MINTED spawn
 * token, which only ever reaches the spawned pi's environment, so a synthetic
 * bridge cannot know it a priori. This change makes the token observable on the
 * fired `REGISTER_TIMEOUT` entry (design D5), and these specs read it back from
 * `GET /api/spawn-failures` — the same join key an operator now uses to tell a
 * recovered timeout from one that never recovered.
 *
 * L1-PINNED, deliberately not repeated here: the >60 s register boundary
 * (test-plan F1, X12). Reproducing it live costs a 70 s wall-clock wait per
 * case, and the boundary itself is pinned deterministically on fake timers by
 * E4/E5 (89_999 ms resolves / 155_001 ms evicted), E7/E8 (arm and TTL agree
 * across a mid-spawn Settings change) and X4 (arm-before-record, final ms of
 * the window). A live variant would re-assert the same arithmetic far more
 * slowly and far more flakily.
 */

/**
 * The harness mounts the host cwd path-identically, so the runner's own cwd is
 * a real directory INSIDE the container too. `/workspace` does not exist there.
 */
const WORKSPACE = process.env.PI_E2E_WORKSPACE ?? process.cwd();

interface HealthBody {
  piGatewayPort?: number | null;
}

interface SpawnFailureEntry {
  code: string;
  cwd: string;
  spawnToken?: string;
  message: string;
  ts: string;
}

async function health(request: APIRequestContext): Promise<HealthBody> {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as HealthBody;
}

async function spawnFailures(request: APIRequestContext): Promise<SpawnFailureEntry[]> {
  const res = await request.get("/api/spawn-failures?limit=200");
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { entries: SpawnFailureEntry[] }).entries;
}

/** Open a raw socket to the pi gateway, the way a bridge does. */
/**
 * A ticket per connection. This spec runs on the HOST and reaches the gateway
 * through a published port, so the container sees the docker bridge address
 * rather than loopback: bridge auth classifies it remote and requires a
 * bridge-scoped credential. Tickets are single-use, so mint one per connect.
 */
let cachedBearer: string | undefined;
async function connect(port: number): Promise<WebSocket> {
  cachedBearer ??= await pairDeviceBearer(BASE_URL);
  const url = await gatewayUrlWithTicket(BASE_URL, port, cachedBearer);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("open timeout")), 5_000);
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
}

function register(ws: WebSocket, fields: Record<string, unknown>): void {
  ws.send(JSON.stringify({ type: "session_register", source: "tui", ...fields }));
}

async function sessionIds(request: APIRequestContext): Promise<string[]> {
  const res = await request.get("/api/sessions");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as any;
  const list = Array.isArray(body) ? body : (body.data ?? body.sessions ?? []);
  return list.map((s: any) => s.id);
}

async function session(request: APIRequestContext, id: string): Promise<any | undefined> {
  const res = await request.get("/api/sessions");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as any;
  const list = Array.isArray(body) ? body : (body.data ?? body.sessions ?? []);
  return list.find((s: any) => s.id === id);
}

test.describe("late spawn register converges (L3)", () => {
  let piPort: number;

  test.beforeAll(async ({ request }) => {
    const body = await health(request);
    piPort = body.piGatewayPort ?? 0;
  });

  test.beforeEach(async ({ request }) => {
    test.skip(!piPort, "harness health does not expose the bound gateway port");
    // Lowest legal timeout so a watchdog fire is seconds away, not minutes.
    const res = await request.put("/api/config", {
      data: { spawnRegisterTimeoutMs: 5_000 },
    });
    expect(res.ok()).toBeTruthy();
  });

  /**
   * Spawn into `cwd` and wait for its watchdog to fire, returning the token the
   * fire recorded. The reclaim kills the real pi, which is precisely the
   * "reclaim missed / late register" state F2 describes — the synthetic bridge
   * below stands in for the pi that finally registers.
   */
  async function firedSpawnToken(request: APIRequestContext, cwd: string): Promise<string> {
    const before = new Set((await spawnFailures(request)).map((e) => e.ts + e.spawnToken));
    const res = await request.post("/api/session/spawn", { data: { cwd } });
    expect(res.ok()).toBeTruthy();

    let token: string | undefined;
    await expect
      .poll(
        async () => {
          const fresh = (await spawnFailures(request)).filter(
            (e) =>
              e.code === "REGISTER_TIMEOUT" &&
              e.cwd === cwd &&
              !before.has(e.ts + e.spawnToken) &&
              e.spawnToken,
          );
          token = fresh.at(-1)?.spawnToken;
          return token;
        },
        { timeout: 60_000, message: "watchdog never fired with a token" },
      )
      .toBeTruthy();
    return token!;
  }

  // F2 — the two halves must move together.
  test("a register inside the recovery window clears the banner AND adds the card", async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const cwd = WORKSPACE;
    const token = await firedSpawnToken(request, cwd);

    // The fire recorded a join key at all — the thing an operator needs to tell
    // a recovered timeout from a dead one.
    expect(token).toBeTruthy();

    const ws = await connect(piPort);
    const sessionId = `e2e-late-register-${Date.now()}`;
    register(ws, { sessionId, cwd, spawnToken: token, pid: 999_001, hasUI: false });

    // The card appears — the half that used to be missing.
    await expect
      .poll(async () => (await sessionIds(request)).includes(sessionId), { timeout: 30_000 })
      .toBe(true);

    // And the recovery was recorded against the fire, joined by the token.
    await expect
      .poll(
        async () =>
          (await spawnFailures(request)).some(
            (e) => e.code === "REGISTER_RECOVERED" && e.spawnToken === token,
          ),
        { timeout: 30_000 },
      )
      .toBe(true);

    ws.close();
  });

  // F3 — a dashboard-spawned headless session must NOT be filtered into Hidden.
  test("a dashboard-spawned headless session stays visible", async ({ request }) => {
    test.setTimeout(60_000);
    const cwd = WORKSPACE;
    const ws = await connect(piPort);
    const sessionId = `e2e-dash-headless-${Date.now()}`;
    register(ws, { sessionId, cwd, pid: 999_002, hasUI: false, dashboardSpawned: true });

    await expect
      .poll(async () => (await session(request, sessionId))?.hidden, { timeout: 30_000 })
      .toBe(false);
    ws.close();
  });

  // F4 — a genuine headless worker in the same cwd still hides.
  test("a headless worker with no dashboard signal stays hidden", async ({ request }) => {
    test.setTimeout(60_000);
    const cwd = WORKSPACE;
    const ws = await connect(piPort);
    const sessionId = `e2e-worker-${Date.now()}`;
    register(ws, { sessionId, cwd, pid: 999_003, hasUI: false });

    await expect
      .poll(async () => (await session(request, sessionId))?.hidden, { timeout: 30_000 })
      .toBe(true);
    ws.close();
  });

  // F5 — registering one spawn must not resolve a concurrent same-cwd spawn.
  test("one spawn registering leaves a concurrent same-cwd spawn still watched", async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const cwd = WORKSPACE;
    const tokenA = await firedSpawnToken(request, cwd);
    const tokenB = await firedSpawnToken(request, cwd);
    expect(tokenA).not.toBe(tokenB);

    const ws = await connect(piPort);
    const sessionId = `e2e-concurrent-a-${Date.now()}`;
    register(ws, { sessionId, cwd, spawnToken: tokenA, pid: 999_004, hasUI: false });

    // A recovers …
    await expect
      .poll(
        async () =>
          (await spawnFailures(request)).some(
            (e) => e.code === "REGISTER_RECOVERED" && e.spawnToken === tokenA,
          ),
        { timeout: 30_000 },
      )
      .toBe(true);

    // … and B's fire is NOT claimed by A's register. Keying every fire by cwd
    // used to let one register resolve both.
    const recovered = (await spawnFailures(request)).filter(
      (e) => e.code === "REGISTER_RECOVERED" && e.spawnToken === tokenB,
    );
    expect(recovered).toHaveLength(0);
    ws.close();
  });

  // F6 — the acknowledged state of a REST prompt is observable, keyed by handle.
  test("a prompt reports transmission and carries a handle", async ({ request }) => {
    test.setTimeout(60_000);
    const cwd = WORKSPACE;
    const ws = await connect(piPort);
    const sessionId = `e2e-prompt-ack-${Date.now()}`;
    register(ws, { sessionId, cwd, pid: 999_005, hasUI: true });
    await expect
      .poll(async () => (await sessionIds(request)).includes(sessionId), { timeout: 30_000 })
      .toBe(true);

    const received: any[] = [];
    ws.addEventListener("message", (ev) => {
      try {
        received.push(JSON.parse(String((ev as MessageEvent).data)));
      } catch {
        /* ignore non-JSON */
      }
    });

    const res = await request.post(`/api/session/${sessionId}/prompt`, { data: { text: "hi" } });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as any;

    // Transmission, explicitly — and no `delivered` the server cannot know.
    expect(body.success).toBe(true);
    expect(body.transmitted).toBe(true);
    expect(body).not.toHaveProperty("delivered");
    expect(typeof body.promptId).toBe("string");

    // The handle made the trip out to the bridge, so an ack can name it.
    await expect
      .poll(() => received.find((m) => m.type === "send_prompt")?.promptId, { timeout: 15_000 })
      .toBe(body.promptId);

    ws.close();
  });
});

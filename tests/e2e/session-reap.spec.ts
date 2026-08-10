/**
 * L3 — the reap fixture's behaviour against the real harness.
 *
 * These are the scenarios that cannot be unit-tested: they need a live
 * dashboard, real spawned pi processes, and the fixture's own teardown running
 * between tests. The pure decision logic is covered at L1 in
 * `scripts/__tests__/e2e-reap-core.test.mjs`.
 *
 * Exemplar: `tests/e2e/bus-client-goal-plugin-action.spec.ts` (headless
 * `BusClient` driven directly against the harness, no browser page). Port comes
 * from `.pi-test-harness.json` via `DASHBOARD_PORT` — never hardcoded.
 *
 * See change: fix-e2e-harness-memory-exhaustion (test-plan #E2, #E3, #E8, #X1).
 */

import crypto from "node:crypto";
import { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import type { SpawnResultBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { expect, test } from "./fixtures.js";
import { DASHBOARD_PORT } from "./lifecycle.js";
import { FIXTURE_GIT } from "./helpers/index.js";

/**
 * Spawn a session and resolve its id.
 *
 * `client.spawn()`'s exact `spawnRequestId` correlation needs the server's
 * headless strategy, which the harness build does not use, so resolve robustly:
 * fire `spawn_session`, await `spawn_result` success, then poll for the new id.
 * Same approach as the bus-client exemplar.
 */
async function spawnSession(client: BusClient, cwd: string): Promise<string> {
  const before = new Set(client.read.sessions().map((s) => s.id));
  const requestId = crypto.randomUUID();
  const result = client.await<SpawnResultBrowserMessage>(
    { type: "spawn_result" },
    { timeout: 45_000 },
  );
  client.send({ type: "spawn_session", cwd, requestId });
  const res = await result;
  expect(res.success, res.message).toBe(true);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const fresh = client.read.sessions().find((s) => !before.has(s.id));
    if (fresh) return fresh.id;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no new session appeared after spawn_result success");
}

async function withBus<T>(fn: (client: BusClient) => Promise<T>): Promise<T> {
  const client = new BusClient({ host: "localhost", port: DASHBOARD_PORT });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

/** Session ids seen live, read fresh over a short-lived bus connection. */
async function liveSessionIds(): Promise<string[]> {
  return withBus(async (c) => c.read.sessions().map((s) => s.id));
}

// Ids this file spawned, recorded so the NEXT test can assert they are gone.
// Module state is safe here: workers: 1 + fullyParallel: false.
let spawnedInPreviousTest: string[] = [];

test.describe("session reap (L3)", () => {
  test("E2: sessions a spec spawns are recorded for the next test to check", async () => {
    const ids = await withBus(async (client) => [
      await spawnSession(client, FIXTURE_GIT),
      await spawnSession(client, FIXTURE_GIT),
    ]);

    expect(ids).toHaveLength(2);
    const live = await liveSessionIds();
    // Sanity: both are live WHILE the test body is still running. The reap is a
    // teardown, so it must not have fired yet.
    for (const id of ids) expect(live).toContain(id);

    spawnedInPreviousTest = ids;
  });

  test("E2: those sessions did NOT outlive the test that spawned them", async () => {
    test.skip(spawnedInPreviousTest.length === 0, "previous test did not record spawned ids");

    const live = await liveSessionIds();
    for (const id of spawnedInPreviousTest) {
      expect(
        live,
        `session ${id} outlived the spec that spawned it — the reap did not run or did not complete`,
      ).not.toContain(id);
    }
  });

  test("X1: reaping a session that is already gone is treated as success", async () => {
    const id = await withBus(async (client) => {
      const sessionId = await spawnSession(client, FIXTURE_GIT);
      // Kill it OURSELVES mid-test, exactly as notify-channel.spec.ts does.
      // The fixture's teardown will then target an id the server no longer
      // knows. That must be success, not an error, and must not fail this spec.
      client.send({ type: "shutdown", sessionId });
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (!client.read.sessions().some((s) => s.id === sessionId)) return sessionId;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(`session ${sessionId} never went away after an explicit shutdown`);
    });

    // Reaching here at all is most of the point: the fixture teardown for THIS
    // test runs against a dead id and must not turn the spec red.
    expect(id).toBeTruthy();
    expect(await liveSessionIds()).not.toContain(id);
  });

  test("E8: a spec starting against an empty container can still spawn and reach its assertions", async () => {
    // After the reaps above the container usually holds no spec-owned sessions.
    // A spec must not depend on a warm card left by a predecessor.
    const id = await withBus(async (client) => spawnSession(client, FIXTURE_GIT));
    expect(id).toBeTruthy();
    expect(await liveSessionIds()).toContain(id);
  });

  test("E3: a pre-existing harness session is never reaped", async () => {
    // Only meaningful when the harness booted its own independent pi. That
    // session predates every test, so it is never in a delta and must survive
    // every reap above.
    const sessions = await withBus(async (c) => c.read.sessions());
    const independent = sessions.filter((s) => s.source === "tui");
    test.skip(
      independent.length === 0,
      "harness not booted with PI_E2E_INDEPENDENT_SESSION=1",
    );

    for (const s of independent) {
      expect(
        s.live,
        `harness-owned session ${s.id} was reaped — the delta misclassified a pre-existing session`,
      ).not.toBe(false);
    }
  });
});

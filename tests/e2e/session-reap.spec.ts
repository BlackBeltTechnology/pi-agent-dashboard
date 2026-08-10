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
 * See change: fix-e2e-harness-memory-exhaustion
 * (test-plan #E2, #E3, #E8, #X1, #X7, #F1, #F2, #F3, #F4).
 */

import crypto from "node:crypto";
import { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import type { SpawnResultBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { expect, test } from "./fixtures.js";
import { DASHBOARD_PORT } from "./lifecycle.js";
import { FIXTURE_GIT } from "./helpers/index.js";
import { isLiveSession } from "./reap-core.js";

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

/**
 * Ids of sessions that are actually LIVE, read fresh over a short-lived bus
 * connection.
 *
 * The filter is load-bearing, not a convenience. The session list retains a
 * record until the server removes it, so a reaped session lingers briefly with
 * `live:false`/`status:"ended"`. Asserting on mere presence therefore reports a
 * correctly-reaped session as surviving — the same defect this change fixed in
 * the fixture's budget check, which is where the predicate comes from.
 */
async function liveSessionIds(): Promise<string[]> {
  return withBus(async (c) =>
    c.read
      .sessions()
      .filter((s) => isLiveSession({ id: s.id, live: s.live, status: s.status }))
      .map((s) => s.id),
  );
}

/**
 * Restart the dashboard daemon and wait for it to answer again.
 *
 * Same lever `faux-ask.spec.ts` pulls. It drops every socket, which is exactly
 * the condition #F3 exists to exercise.
 */
async function restartDashboard(): Promise<void> {
  await fetch(`http://localhost:${DASHBOARD_PORT}/api/restart`, { method: "POST" }).catch(
    () => undefined, // the connection dies with the daemon; that is the point
  );
  const deadline = Date.now() + 120_000;
  await new Promise((r) => setTimeout(r, 2_000));
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${DASHBOARD_PORT}/api/health`);
      if (res.ok) return;
    } catch {
      // still down
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back after POST /api/restart");
}

// Ids this file spawned, recorded so the NEXT test can assert they are gone.
// Module state is safe here: workers: 1 + fullyParallel: false.
let spawnedInPreviousTest: string[] = [];
let midTurnSessionId = "";
let reapedBeforeRestart = "";
let postRestartSessionId = "";

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
        const rec = client.read.sessions().find((s) => s.id === sessionId);
        if (!rec || !isLiveSession({ id: rec.id, live: rec.live, status: rec.status })) {
          return sessionId;
        }
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

  test("F4: a session mid-turn when the body ends still converges to removed", async () => {
    // The reap must not race an in-flight turn: if a session is streaming when
    // the test body returns, teardown still has to drive it to gone rather than
    // giving up or hanging.
    const id = await withBus(async (client) => {
      const sessionId = await spawnSession(client, FIXTURE_GIT);
      // Start a turn and deliberately do NOT await its completion.
      client.prompt(sessionId, "[[faux:plain-text]]");
      // Give the turn a moment to actually be in flight when the body ends.
      await new Promise((r) => setTimeout(r, 1_500));
      return sessionId;
    });
    midTurnSessionId = id;
  });

  test("F4: the mid-turn session was reaped despite streaming", async () => {
    test.skip(!midTurnSessionId, "previous test did not record a mid-turn session");
    expect(
      await liveSessionIds(),
      `session ${midTurnSessionId} survived the reap — teardown raced an in-flight turn`,
    ).not.toContain(midTurnSessionId);
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

/**
 * Hook-ordering scenarios (#F1, #F2).
 *
 * The reap is a fixture teardown, and Playwright runs fixture teardown AFTER a
 * test's own `afterEach` but BEFORE the file's `afterAll`. Five existing specs
 * depend on that ordering (audited in the change's `measurements.md`), so it is
 * pinned here rather than left as an assumption.
 */
test.describe("reap vs per-spec hooks (L3)", () => {
  let hookSessionId = "";
  let afterEachSawItLive: boolean | undefined;

  test.afterEach(async () => {
    if (!hookSessionId) return;
    // #F1: a spec's OWN afterEach must still see its session live, because the
    // five existing specs with afterEach hooks restore state through it.
    afterEachSawItLive = (await liveSessionIds()).includes(hookSessionId);
  });

  test.afterAll(async () => {
    // #F2: afterAll runs AFTER fixture teardown, so the session is already
    // reaped by now. The contract is only that this completes without error.
    if (!hookSessionId) return;
    await liveSessionIds();
  });

  test("F1: a spec's own afterEach still observes its session live", async () => {
    hookSessionId = await withBus(async (client) => spawnSession(client, FIXTURE_GIT));
    expect(await liveSessionIds()).toContain(hookSessionId);
  });

  test("F1: the afterEach hook saw the session live, and the reap ran after it", async () => {
    test.skip(afterEachSawItLive === undefined, "afterEach hook did not run");
    expect(
      afterEachSawItLive,
      "the spec's own afterEach ran AFTER the reap — state-restoring hooks in existing specs would break",
    ).toBe(true);
    expect(
      await liveSessionIds(),
      "the session survived the reap that should have followed the afterEach",
    ).not.toContain(hookSessionId);
  });
});

/**
 * #F3 + #X7 — both need the daemon to restart mid-suite, so they share one
 * restart to keep the suite's cost down. `faux-ask.spec.ts` establishes that
 * restarting mid-run is legitimate.
 */
test.describe("reap across a daemon restart (L3)", () => {
  test("X7: spawn and reap a session, then restart the daemon", async () => {
    const id = await withBus(async (client) => {
      const sessionId = await spawnSession(client, FIXTURE_GIT);
      client.send({ type: "shutdown", sessionId });
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const rec = client.read.sessions().find((s) => s.id === sessionId);
        if (!rec || !isLiveSession({ id: rec.id, live: rec.live, status: rec.status })) {
          return sessionId;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(`session ${sessionId} did not go away before the restart`);
    });
    reapedBeforeRestart = id;
    await restartDashboard();
  });

  test("X7: the reaped session is not restored as a recovery candidate", async () => {
    test.skip(!reapedBeforeRestart, "previous test did not reap a session");
    // The reap uses the WS shutdown path precisely because it writes
    // closedReason:"manual", which is what keeps isRecoveryCandidate from
    // offering the session back after a cold start.
    expect(
      await liveSessionIds(),
      `reaped session ${reapedBeforeRestart} came back after a restart — it was treated as an interrupted session`,
    ).not.toContain(reapedBeforeRestart);
  });

  test("F3: the reap still works after every socket was dropped", async () => {
    // The previous test restarted the daemon, killing every bus socket. The
    // fixture opens a per-test client, so this spawn+reap must simply work; a
    // worker-scoped client would fail here with 'bus client not connected'.
    const id = await withBus(async (client) => spawnSession(client, FIXTURE_GIT));
    expect(id).toBeTruthy();
    postRestartSessionId = id;
  });

  test("F3: the post-restart session was reaped normally", async () => {
    test.skip(!postRestartSessionId, "previous test did not spawn a session");
    expect(
      await liveSessionIds(),
      `session ${postRestartSessionId} survived — the reap did not recover from the restart`,
    ).not.toContain(postRestartSessionId);
  });
});

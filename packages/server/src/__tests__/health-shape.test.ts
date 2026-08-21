/**
 * Tests for /api/health response shape.
 *
 * Asserts:
 *  - `pid` field is present (regression pin).
 *  - `launchSource` field is present and reflects DASHBOARD_STARTER.
 *  - `bootParentPid`, `ppid`, `bootParentAlive`, `activeBridgeCount`,
 *    `launchSourceEffective` are present with the right types on every case.
 *    See change: electron-attach-ownership-fixes.
 *
 * `launchSource` replaces the legacy `starter` field per change:
 * eliminate-electron-runtime-install (task 3.2). It is the single source
 * of truth for arm-aware client gating (e.g. hiding pi-core update UI
 * under Electron, since bundled node_modules/ is read-only there).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMemoryEventStore,
  EMPTY_TRIM_STATS,
} from "../persistence/memory-event-store.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

let handle: TestServerHandle | undefined;
let savedStarter: string | undefined;

describe("GET /api/health — shape", () => {
  beforeEach(() => {
    savedStarter = process.env.DASHBOARD_STARTER;
  });

  afterEach(async () => {
    if (handle) {
      try { await handle.stop(); } catch { /* already stopped */ }
      handle = undefined;
    }
    if (savedStarter === undefined) delete process.env.DASHBOARD_STARTER;
    else process.env.DASHBOARD_STARTER = savedStarter;
  });

  // Shared shape assertions for the ownership/liveness fields. The ppid reader
  // is platform-branched (POSIX syscall vs Windows `process.ppid`) but the
  // response SHAPE is uniform across all three OSes — these type checks must
  // hold in CI on every platform.
  function assertOwnershipShape(body: Record<string, unknown>): void {
    expect(typeof body.bootParentPid).toBe("number");
    expect(typeof body.ppid).toBe("number");
    expect(typeof body.bootParentAlive).toBe("boolean");
    expect(typeof body.activeBridgeCount).toBe("number");
    expect(typeof body.launchSourceEffective).toBe("string");
  }

  it("includes pid field (regression pin)", async () => {
    delete process.env.DASHBOARD_STARTER;
    handle = await createTestServer();
    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.pid).toBe("number");
    expect(body.pid).toBe(process.pid);
    assertOwnershipShape(body);
  });

  it("launchSource defaults to 'standalone' when DASHBOARD_STARTER unset", async () => {
    delete process.env.DASHBOARD_STARTER;
    handle = await createTestServer();
    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    const body = await res.json() as Record<string, unknown>;
    expect(body.launchSource).toBe("standalone");
    expect(body.launchSourceEffective).toBe("standalone");
    assertOwnershipShape(body);
  });

  it("launchSource is 'electron' when DASHBOARD_STARTER=Electron", async () => {
    process.env.DASHBOARD_STARTER = "Electron";
    handle = await createTestServer();
    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    const body = await res.json() as Record<string, unknown>;
    expect(body.launchSource).toBe("electron");
    // Electron is never promoted regardless of bridge count / uptime.
    expect(body.launchSourceEffective).toBe("electron");
    assertOwnershipShape(body);
  });

  it("surfaces per-hop dropped-frame counters (fix-stuck-tool-card-on-dropped-event)", async () => {
    delete process.env.DASHBOARD_STARTER;
    handle = await createTestServer();
    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    const body = await res.json() as Record<string, unknown>;
    const dropped = body.droppedFrames as {
      serverToBrowser: { total: number; bySession: Record<string, number>; forcedReconnects: number };
      bridgeToServer: number;
    };
    expect(dropped).toBeDefined();
    expect(typeof dropped.serverToBrowser.total).toBe("number");
    expect(typeof dropped.serverToBrowser.bySession).toBe("object");
    expect(typeof dropped.serverToBrowser.forcedReconnects).toBe("number");
    expect(typeof dropped.bridgeToServer).toBe("number");
    // Fresh server: no drops or forced reconnects yet.
    expect(dropped.serverToBrowser.total).toBe(0);
    expect(dropped.serverToBrowser.forcedReconnects).toBe(0);
    expect(dropped.bridgeToServer).toBe(0);
  });

  it("surfaces store-trim counters (instrument-event-store-trim)", async () => {
    delete process.env.DASHBOARD_STARTER;
    handle = await createTestServer();
    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    const body = await res.json() as Record<string, unknown>;
    const storeTrim = body.storeTrim as {
      trimmedEvents: { total: number; toolExecutionEnd: number; bySession: Record<string, number> };
      evictedSessions: number;
    };
    expect(storeTrim).toBeDefined();
    expect(typeof storeTrim.trimmedEvents.total).toBe("number");
    expect(typeof storeTrim.trimmedEvents.toolExecutionEnd).toBe("number");
    expect(typeof storeTrim.trimmedEvents.bySession).toBe("object");
    expect(typeof storeTrim.evictedSessions).toBe("number");
    // Fresh server: nothing trimmed or evicted yet.
    expect(storeTrim.trimmedEvents.total).toBe(0);
    expect(storeTrim.trimmedEvents.toolExecutionEnd).toBe(0);
    expect(storeTrim.evictedSessions).toBe(0);
  });

  // X5: adding `collapsedUpdates` is ADDITIVE — the new counter is present AND
  // every pre-existing storeTrim field keeps its original name and type.
  // See change: collapse-superseded-tool-execution-updates.
  it("storeTrim gains collapsedUpdates additively (collapse-superseded-tool-execution-updates)", async () => {
    delete process.env.DASHBOARD_STARTER;
    handle = await createTestServer();
    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    const body = await res.json() as Record<string, unknown>;
    const storeTrim = body.storeTrim as Record<string, unknown>;
    // New counter present…
    expect(typeof storeTrim.collapsedUpdates).toBe("number");
    expect(storeTrim.collapsedUpdates).toBe(0);
    // …and NOTHING pre-existing moved, renamed, or changed type.
    const trimmed = storeTrim.trimmedEvents as Record<string, unknown>;
    expect(typeof trimmed.total).toBe("number");
    expect(typeof trimmed.toolExecutionEnd).toBe("number");
    expect(typeof trimmed.bySession).toBe("object");
    expect(typeof storeTrim.evictedSessions).toBe("number");
  });

  // Same additive contract for the subagent-tick byte counters: surfaced on
  // /api/health via the store's exported TrimStats, nothing pre-existing moved.
  // See change: reduce-subagent-details-payload (D6, task 9.2).
  it("storeTrim gains the subagent-tick byte counters additively", async () => {
    delete process.env.DASHBOARD_STARTER;
    handle = await createTestServer();
    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    const body = (await res.json()) as Record<string, unknown>;
    const storeTrim = body.storeTrim as Record<string, unknown>;
    for (const field of [
      "subagentTicks",
      "subagentTickBytes",
      "subagentFatTicks",
      "subagentTickFatBytes",
    ]) {
      expect(typeof storeTrim[field]).toBe("number");
      expect(storeTrim[field]).toBe(0);
    }
    expect(typeof storeTrim.collapsedUpdates).toBe("number");
    expect(typeof storeTrim.evictedSessions).toBe("number");
  });

  // The throttle's counters are additive on the SAME response: nothing that
  // shipped before moved, and the four fields are present (all-zero on a fresh
  // server with no bridge). Asserted in the same commit as the transport, so a
  // shape drift between bridge heartbeat and route can never land silently.
  // See change: reduce-bridge-tick-bandwidth (D6, task 4.2).
  it("gains the subagent-tick throttle counters additively", async () => {
    delete process.env.DASHBOARD_STARTER;
    handle = await createTestServer();
    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    const body = (await res.json()) as Record<string, unknown>;

    const throttle = body.subagentTickThrottle as Record<string, unknown>;
    expect(throttle).toBeDefined();
    expect(Object.keys(throttle).sort()).toEqual([
      "tickCoalesced",
      "tickDiscardedAtTerminal",
      "tickDroppedNotReady",
      "tickForwarded",
    ]);
    for (const v of Object.values(throttle)) expect(v).toBe(0);

    // Pre-existing fields unchanged (the additive half of the contract).
    expect(typeof body.pid).toBe("number");
    expect(typeof body.storeTrim).toBe("object");
    expect(typeof body.droppedFrames).toBe("object");
    expect(Array.isArray(body.agents)).toBe(true);
  });

  // X6: the `??` fallback the route takes when no event store is wired. It is
  // the store's explicitly-typed EMPTY_TRIM_STATS, not an inline literal —
  // `a ?? b` does not check `b` against `A`, so an inline literal could silently
  // omit a newly-required field. Assert the fallback's shape MATCHES a live
  // store's, so a future field cannot land on one side only.
  it("the /api/health storeTrim fallback satisfies the live store's TrimStats shape", () => {
    const live = createMemoryEventStore(() => false).getTrimStats();
    expect(Object.keys(EMPTY_TRIM_STATS).sort()).toEqual(Object.keys(live).sort());
    expect(Object.keys(EMPTY_TRIM_STATS.trimmedEvents).sort()).toEqual(
      Object.keys(live.trimmedEvents).sort(),
    );
    // Same value types on every key, not merely the same key names.
    for (const k of Object.keys(live) as Array<keyof typeof live>) {
      expect(typeof EMPTY_TRIM_STATS[k]).toBe(typeof live[k]);
    }
    expect(EMPTY_TRIM_STATS).toEqual(live); // a fresh store is all-zero
  });

  it("launchSource is 'bridge' when DASHBOARD_STARTER=Bridge", async () => {
    process.env.DASHBOARD_STARTER = "Bridge";
    handle = await createTestServer();
    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    const body = await res.json() as Record<string, unknown>;
    expect(body.launchSource).toBe("bridge");
    // Inside the 30 s grace window a freshly-booted test server stays "bridge"
    // even with zero connected bridges.
    expect(body.launchSourceEffective).toBe("bridge");
    assertOwnershipShape(body);
  });
});

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
import { describe, it, expect, afterEach, beforeEach } from "vitest";
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
      serverToBrowser: { total: number; bySession: Record<string, number> };
      bridgeToServer: number;
    };
    expect(dropped).toBeDefined();
    expect(typeof dropped.serverToBrowser.total).toBe("number");
    expect(typeof dropped.serverToBrowser.bySession).toBe("object");
    expect(typeof dropped.bridgeToServer).toBe("number");
    // Fresh server: no drops yet.
    expect(dropped.serverToBrowser.total).toBe(0);
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

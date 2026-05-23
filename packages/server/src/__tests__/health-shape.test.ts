/**
 * Tests for /api/health response shape.
 *
 * Asserts:
 *  - `pid` field is present (regression pin).
 *  - `launchSource` field is present and reflects DASHBOARD_STARTER.
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

  it("includes pid field (regression pin)", async () => {
    delete process.env.DASHBOARD_STARTER;
    handle = await createTestServer();
    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.pid).toBe("number");
    expect(body.pid).toBe(process.pid);
  });

  it("launchSource defaults to 'standalone' when DASHBOARD_STARTER unset", async () => {
    delete process.env.DASHBOARD_STARTER;
    handle = await createTestServer();
    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    const body = await res.json() as Record<string, unknown>;
    expect(body.launchSource).toBe("standalone");
  });

  it("launchSource is 'electron' when DASHBOARD_STARTER=Electron", async () => {
    process.env.DASHBOARD_STARTER = "Electron";
    handle = await createTestServer();
    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    const body = await res.json() as Record<string, unknown>;
    expect(body.launchSource).toBe("electron");
  });

  it("launchSource is 'bridge' when DASHBOARD_STARTER=Bridge", async () => {
    process.env.DASHBOARD_STARTER = "Bridge";
    handle = await createTestServer();
    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    const body = await res.json() as Record<string, unknown>;
    expect(body.launchSource).toBe("bridge");
  });
});

/**
 * Scenario E2/E3 at the WIRING level: `start()` must route through
 * `runBoundedStartup`, not run the startup body bare. The pure-helper suite
 * (`bounded-startup.test.ts`) proves the helper; this proves the server
 * actually uses it — without this, reverting the `server.ts` wrapper alone
 * would leave the suite green.
 *
 * See change: fix-worktree-server-autostart-leak.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

let server: any;

afterEach(async () => {
  try { await server?.stop(); } catch { /* ignore */ }
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function makeServer() {
  const sessionsDir = mkdtempSync(path.join(os.tmpdir(), "pi-start-teardown-"));
  vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", sessionsDir);
  vi.stubEnv("PI_DASHBOARD_NO_MDNS", "1");
  vi.resetModules();
  const { createServer } = await import("../server.js");
  const s = await createServer({
    port: 0, piPort: 0, host: "127.0.0.1", dev: true,
    autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
  }) as any;
  return { s, cleanup: () => rmSync(sessionsDir, { recursive: true, force: true }) };
}

describe("server.start() teardown wiring", () => {
  it("E2: a startup-body failure propagates the ORIGINAL error and leaves no listener bound", async () => {
    const { s, cleanup } = await makeServer();
    server = s;
    try {
      // Stand in for "a startup step after piGateway.start() throws". A bare
      // `start()` (pre-change) would ignore this and boot the real body.
      s._startCore = async () => { throw new Error("plugin load failed"); };

      await expect(s.start()).rejects.toThrow("plugin load failed");

      // Teardown ran: neither listener is bound.
      expect(s.piPort()).toBeNull();
      expect(s.httpPort()).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("E3: a successful startup keeps BOTH listeners open (teardown never runs)", async () => {
    const { s, cleanup } = await makeServer();
    server = s;
    try {
      await s.start();
      expect(s.piPort()).toBeGreaterThan(0);
      expect(s.httpPort()).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it("the startup body is reachable as a separate member, so start() is a wrapper", async () => {
    const { s, cleanup } = await makeServer();
    server = s;
    try {
      expect(typeof s._startCore).toBe("function");
      expect(s._startCore).not.toBe(s.start);
    } finally {
      cleanup();
    }
  });
});

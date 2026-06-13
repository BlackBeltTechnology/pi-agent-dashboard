/**
 * EditorManager 3-way resolution + keeper-mediated stop tests.
 *
 * Mocks the injected `keeperManager` to drive the manager through every
 * branch (in-memory, reattach, fresh spawn) and verify that stop /
 * stopAll respect the new keeper protocol and the
 * `stopOnDashboardExit` config flag.
 *
 * Tasks: 7.4, 7.5, 7.6.
 */
import { describe, it, expect, vi } from "vitest";
import net from "node:net";
import { createEditorManager } from "../editor-manager.js";
import type { EditorKeeperManager } from "../editor-keeper/keeper-manager.js";
import type { EditorConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { EditorDetectionResult } from "@blackbelt-technology/pi-dashboard-shared/editor-types.js";

const DETECTED: EditorDetectionResult = { available: true, binary: "/fake/code-server" };

const BASE_CONFIG: EditorConfig = {
  idleTimeoutMinutes: 10,
  maxInstances: 3,
  stopOnDashboardExit: false,
};

function makeKeeperManager(overrides: Partial<EditorKeeperManager> = {}): EditorKeeperManager {
  const exitHandlers = new Map<string, Array<() => void>>();
  const km: EditorKeeperManager = {
    editorsDir: "/tmp/editors",
    spawnKeeperFor: vi.fn(async ({ cwd, port }) => ({
      success: true,
      editorId: `id-${Buffer.from(cwd).toString("hex").slice(0, 8)}`,
      keeperPid: 12345,
      sockPath: "/tmp/sock",
    })) as any,
    probe: vi.fn(async () => ({ alive: false, editorId: "x" })) as any,
    writeCommand: vi.fn(async () => undefined) as any,
    onChildExit: vi.fn((editorId, handler) => {
      const list = exitHandlers.get(editorId) ?? [];
      list.push(() => handler({ code: 0, signal: null }));
      exitHandlers.set(editorId, list);
      return () => { /* dispose noop */ };
    }) as any,
    killKeeper: vi.fn(async () => undefined) as any,
    discoverExistingKeepers: vi.fn(async () => []) as any,
    ...overrides,
  };
  // Expose the exit-handler list so tests can fire child_exit synchronously.
  (km as any).__fireChildExit = (editorId: string) => {
    const list = exitHandlers.get(editorId) ?? [];
    for (const fn of list) fn();
  };
  return km;
}

// ── 7.4: 3-way resolution ────────────────────────────────────────────────────

describe("editor-manager.start — 3-way resolution (task 7.4)", () => {
  it("returns existing in-memory instance without contacting keeper", async () => {
    // Bind real listener so first start() sees a ready port.
    const server = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", () => r(null)));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const km = makeKeeperManager({
        probe: vi.fn(async () => ({ alive: false, editorId: "x" })) as any,
        // spawnKeeperFor binds nothing; we rely on probe being polled.
        spawnKeeperFor: vi.fn(async () => ({
          success: true,
          editorId: "deadbeef",
          keeperPid: 1,
          sockPath: "/tmp/s",
        })) as any,
      });
      // Make probe return alive after the first failure to satisfy waitForKeeperReady.
      let calls = 0;
      (km.probe as any).mockImplementation(async () => {
        calls++;
        return calls > 1
          ? { alive: true, editorId: "x", port, cwd: "/proj", dataDir: "/d" }
          : { alive: false, editorId: "x" };
      });
      const mgr = createEditorManager({ config: BASE_CONFIG, detection: DETECTED, keeperManager: km });
      const a = await mgr.start("/proj");
      const b = await mgr.start("/proj");
      expect(a.id).toBe(b.id);
      // probe called many times during waitForKeeperReady; spawn called exactly once.
      expect(km.spawnKeeperFor).toHaveBeenCalledTimes(1);
    } finally {
      server.close();
    }
  });

  it("reattaches when keeper.probe reports alive (no spawn)", async () => {
    const km = makeKeeperManager({
      probe: vi.fn(async () => ({
        alive: true, editorId: "x", port: 4242, cwd: "/proj", dataDir: "/d",
      })) as any,
    });
    const mgr = createEditorManager({ config: BASE_CONFIG, detection: DETECTED, keeperManager: km });
    const info = await mgr.start("/proj");
    expect(info.status).toBe("ready");
    expect(info.port).toBe(4242);
    expect(km.spawnKeeperFor).not.toHaveBeenCalled();
  });

  it("spawns fresh keeper when in-memory + probe both miss", async () => {
    const server = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", () => r(null)));
    const port = (server.address() as net.AddressInfo).port;
    try {
      let probeCalls = 0;
      const km = makeKeeperManager({
        probe: vi.fn(async () => {
          probeCalls++;
          // miss on the pre-spawn probe; hit on the post-spawn waitForKeeperReady.
          return probeCalls === 1
            ? { alive: false, editorId: "x" }
            : { alive: true, editorId: "x", port, cwd: "/p", dataDir: "/d" };
        }) as any,
      });
      const mgr = createEditorManager({ config: BASE_CONFIG, detection: DETECTED, keeperManager: km });
      const info = await mgr.start("/proj-fresh");
      expect(info.status).toBe("ready");
      expect(km.spawnKeeperFor).toHaveBeenCalledTimes(1);
    } finally {
      server.close();
    }
  });

  it("dedups concurrent start(cwd) for the same folder — one spawn, shared instance", async () => {
    const server = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", () => r(null)));
    const port = (server.address() as net.AddressInfo).port;
    try {
      let probeCalls = 0;
      const km = makeKeeperManager({
        probe: vi.fn(async () => {
          probeCalls++;
          return probeCalls === 1
            ? { alive: false, editorId: "x" }
            : { alive: true, editorId: "x", port, cwd: "/p", dataDir: "/d" };
        }) as any,
      });
      const mgr = createEditorManager({ config: BASE_CONFIG, detection: DETECTED, keeperManager: km });
      // Two browser instances open the same folder at the same time.
      const [a, b] = await Promise.all([mgr.start("/proj-race"), mgr.start("/proj-race")]);
      // Shared instance; only ONE keeper spawned (no duplicate code-server on
      // the same locked --user-data-dir).
      expect(a.id).toBe(b.id);
      expect(km.spawnKeeperFor).toHaveBeenCalledTimes(1);
      expect(mgr.list()).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it("rejects a blank/whitespace cwd without spawning", async () => {
    const km = makeKeeperManager();
    const mgr = createEditorManager({ config: BASE_CONFIG, detection: DETECTED, keeperManager: km });
    await expect(mgr.start("   ")).rejects.toThrow("cwd_required");
    await expect(mgr.start("")).rejects.toThrow("cwd_required");
    expect(km.spawnKeeperFor).not.toHaveBeenCalled();
    expect(mgr.list()).toHaveLength(0);
  });
});

// ── 7.5: stop semantics ──────────────────────────────────────────────────────

describe("editor-manager.stop — keeper-mediated (task 7.5)", () => {
  it("writes {cmd:'stop'} to keeper and removes entry on child_exit", async () => {
    const km = makeKeeperManager({
      probe: vi.fn(async () => ({
        alive: true, editorId: "x", port: 4242, cwd: "/p", dataDir: "/d",
      })) as any,
    });
    const mgr = createEditorManager({ config: BASE_CONFIG, detection: DETECTED, keeperManager: km });
    const info = await mgr.start("/p");
    expect(mgr.list().length).toBe(1);

    const stopPromise = mgr.stop(info.id);
    // wait a tick for stop()'s async writeCommand to schedule
    await new Promise((r) => setImmediate(r));
    expect(km.writeCommand).toHaveBeenCalledWith(info.id, { cmd: "stop" });

    // Fire child_exit; cleanup should drop the instance.
    (km as any).__fireChildExit(info.id);
    await stopPromise;
    expect(mgr.list().length).toBe(0);
  });
});

// ── 7.6: stopAll config gating ───────────────────────────────────────────────

describe("editor-manager.stopAll — config-gated (task 7.6)", () => {
  it("does NOT signal any keeper when stopOnDashboardExit=false", async () => {
    const km = makeKeeperManager({
      probe: vi.fn(async () => ({
        alive: true, editorId: "x", port: 4242, cwd: "/p1", dataDir: "/d",
      })) as any,
    });
    const mgr = createEditorManager({
      config: { ...BASE_CONFIG, stopOnDashboardExit: false },
      detection: DETECTED,
      keeperManager: km,
    });
    await mgr.start("/p1");
    (km.writeCommand as any).mockClear();
    await mgr.stopAll();
    expect(km.writeCommand).not.toHaveBeenCalled();
    expect(mgr.list().length).toBe(0); // local cleanup still happens
  });

  it("signals every keeper when stopOnDashboardExit=true", async () => {
    const km = makeKeeperManager({
      probe: vi.fn(async () => ({
        alive: true, editorId: "x", port: 4242, cwd: "/p", dataDir: "/d",
      })) as any,
    });
    const mgr = createEditorManager({
      config: { ...BASE_CONFIG, stopOnDashboardExit: true },
      detection: DETECTED,
      keeperManager: km,
    });
    const a = await mgr.start("/pA");
    const b = await mgr.start("/pB");

    (km.writeCommand as any).mockClear();
    const stopP = mgr.stopAll();
    // Fire child_exit for both so stopAll resolves without waiting 6 s.
    await new Promise((r) => setImmediate(r));
    (km as any).__fireChildExit(a.id);
    (km as any).__fireChildExit(b.id);
    await stopP;

    expect(km.writeCommand).toHaveBeenCalledWith(a.id, { cmd: "stop" });
    expect(km.writeCommand).toHaveBeenCalledWith(b.id, { cmd: "stop" });
  });

  it("forceStopAll bypasses the flag", async () => {
    const km = makeKeeperManager({
      probe: vi.fn(async () => ({
        alive: true, editorId: "x", port: 4242, cwd: "/p", dataDir: "/d",
      })) as any,
    });
    const mgr = createEditorManager({
      config: { ...BASE_CONFIG, stopOnDashboardExit: false },
      detection: DETECTED,
      keeperManager: km,
    });
    const info = await mgr.start("/p-force");

    (km.writeCommand as any).mockClear();
    const stopP = mgr.forceStopAll();
    await new Promise((r) => setImmediate(r));
    (km as any).__fireChildExit(info.id);
    await stopP;

    expect(km.writeCommand).toHaveBeenCalledWith(info.id, { cmd: "stop" });
  });
});

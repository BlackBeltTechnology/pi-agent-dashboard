/**
 * Regression tests for the source-stamp path in `event-wiring.ts`.
 *
 * Pins the wire-up between `session_register` and
 * `decideDashboardSource`:
 *   - Strong signal → in-memory stamp + .meta.json persists "dashboard"
 *   - Cwd-FIFO legacy → in-memory stamp + .meta.json does NOT persist + log emitted
 *   - Strict mode → no stamp, no broadcast, no persist, no log
 *
 * See change: fix-dashboard-spawn-correlation-by-token.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TestRig {
  server: {
    stop: () => Promise<void>;
    sessionManager: { get: (id: string) => { source?: string } | undefined };
    pendingDashboardSpawns: Map<string, number>;
  };
  piPort: number;
  tmpDir: string;
  logs: string[];
}

async function startServerWithEnv(env: Record<string, string | undefined>): Promise<TestRig> {
  // Capture stdout writes so we can assert the fallback log line.
  const logs: string[] = [];
  const origLog = console.log;
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
    // Don't pipe to real stdout — keeps test output clean.
  });

  // Stub env BEFORE module load so the module-level constant reads the
  // intended value.
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, "");
    else vi.stubEnv(k, v);
  }
  vi.resetModules();
  const { createServer } = await import("../server.js");

  const server = await createServer({
    port: 0,
    piPort: 0,
    host: "127.0.0.1",
    dev: true,
    autoShutdown: false,
    shutdownIdleSeconds: 999,
    tunnel: false,
  });
  await server.start();
  const piPort = server.piPort()!;

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-srcstamp-"));

  return {
    server: {
      stop: async () => {
        await server.stop();
        vi.spyOn(console, "log").mockRestore?.();
        // Restore as last resort.
        console.log = origLog;
        vi.unstubAllEnvs();
      },
      sessionManager: server.sessionManager,
      pendingDashboardSpawns: server.pendingDashboardSpawns,
    },
    piPort,
    tmpDir,
    logs,
  };
}

async function sendRegister(piPort: number, payload: Record<string, unknown>): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
  await new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "session_register", ...payload }));
      resolve();
    });
  });
  return ws;
}

describe("event-wiring: source-stamp gating", () => {
  let rig: TestRig | undefined;

  afterEach(async () => {
    if (rig) {
      await rig.server.stop();
      rig = undefined;
    }
  });

  it("strong signal (dashboardSpawned=true) stamps in-memory AND persists .meta.json", async () => {
    rig = await startServerWithEnv({ STRICT_SPAWN_CORRELATION: undefined });
    const SID = "src-strong-sess";
    const sessionFile = path.join(rig.tmpDir, `${SID}.jsonl`);
    writeFileSync(sessionFile, "");

    await sendRegister(rig.piPort, {
      sessionId: SID,
      cwd: rig.tmpDir,
      source: "tui",
      sessionFile,
      dashboardSpawned: true,
    });
    await wait(80);

    expect(rig.server.sessionManager.get(SID)?.source).toBe("dashboard");
    const meta = readSessionMeta(sessionFile);
    expect(meta?.source).toBe("dashboard");
    // Strong-signal path should NOT emit the cwd-FIFO fallback log.
    expect(rig.logs.some((l) => l.includes("cwd-FIFO source-stamp fallback"))).toBe(false);
  });

  it("legacy cwd-FIFO fallback stamps in-memory but does NOT write .meta.json + logs the fallback", async () => {
    rig = await startServerWithEnv({ STRICT_SPAWN_CORRELATION: undefined });
    const SID = "src-legacy-sess";
    const sessionFile = path.join(rig.tmpDir, `${SID}.jsonl`);
    writeFileSync(sessionFile, "");

    // Simulate a recent dashboard Spawn that bumped the cwd counter.
    rig.server.pendingDashboardSpawns.set(rig.tmpDir, 1);

    await sendRegister(rig.piPort, {
      sessionId: SID,
      cwd: rig.tmpDir,
      source: "tui",
      sessionFile,
      // dashboardSpawned omitted → strong signal absent
    });
    await wait(80);

    expect(rig.server.sessionManager.get(SID)?.source).toBe("dashboard");
    const meta = readSessionMeta(sessionFile);
    expect(meta?.source).toBeUndefined();
    expect(
      rig.logs.some((l) =>
        l.includes("cwd-FIFO source-stamp fallback") &&
        l.includes(SID) &&
        l.includes(rig!.tmpDir),
      ),
    ).toBe(true);
  });

  it("strict mode suppresses the legacy cwd-FIFO fallback entirely", async () => {
    rig = await startServerWithEnv({ STRICT_SPAWN_CORRELATION: "1" });
    const SID = "src-strict-sess";
    const sessionFile = path.join(rig.tmpDir, `${SID}.jsonl`);
    writeFileSync(sessionFile, "");

    rig.server.pendingDashboardSpawns.set(rig.tmpDir, 1);

    await sendRegister(rig.piPort, {
      sessionId: SID,
      cwd: rig.tmpDir,
      source: "tui",
      sessionFile,
    });
    await wait(80);

    // No stamp, no persist, no log.
    expect(rig.server.sessionManager.get(SID)?.source).not.toBe("dashboard");
    const meta = readSessionMeta(sessionFile);
    expect(meta?.source).toBeUndefined();
    expect(rig.logs.some((l) => l.includes("cwd-FIFO source-stamp fallback"))).toBe(false);
    // Counter must NOT be consumed in strict mode.
    expect(rig.server.pendingDashboardSpawns.get(rig.tmpDir)).toBe(1);
  });
});

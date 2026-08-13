/**
 * A refused `session_register` must have NO side effects, and the refused
 * duplicate's pi must still be reclaimed.
 *
 * Covers test-plan #X2 (watchdog stays armed), #X6 (the id-change decision is
 * taken before `clearByToken/Pid/Cwd`) and #X11 (the reclaim runs for a caller
 * with no browser WebSocket).
 *
 * See change: fix-duplicate-bridge-registration (D0, D2).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createPiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import {
  _setSpawnRegisterWatchdogForTests,
  SpawnRegisterWatchdog,
} from "../spawn-process/spawn-register-watchdog.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", () => resolve());
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

async function waitForBind(gateway: { address(): number | null }): Promise<number> {
  for (let i = 0; i < 200; i++) {
    const port = gateway.address();
    if (port !== null) return port;
    await delay(10);
  }
  throw new Error("gateway did not bind a port");
}

async function until(pred: () => boolean, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (pred()) return;
    await delay(10);
  }
  throw new Error("condition not met within timeout");
}

describe("refused register has no side effects", () => {
  let gateway: ReturnType<typeof createPiGateway>;
  let watchdog: SpawnRegisterWatchdog;
  let killed: number[];
  const sockets: WebSocket[] = [];

  beforeEach(() => {
    killed = [];
    // 5 s is the clamp floor (`clampSpawnRegisterTimeoutMs`), so this is the
    // shortest arm the watchdog will actually honour.
    watchdog = new SpawnRegisterWatchdog(5000, {
      findPidsBySpawnToken: (token) => (token === "TOKEN-DUP" ? [9999] : []),
      kill: (pid) => killed.push(pid),
    });
    _setSpawnRegisterWatchdogForTests(watchdog);
  });

  afterEach(() => {
    for (const ws of sockets) ws.terminate();
    sockets.length = 0;
    gateway?.stop();
    _setSpawnRegisterWatchdogForTests(null);
    vi.restoreAllMocks();
  });

  async function start() {
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    gateway.start(0, "127.0.0.1");
    const port = await waitForBind(gateway);
    return { sessionManager, port };
  }

  async function client(port: number) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("error", () => {});
    sockets.push(ws);
    await waitForOpen(ws);
    return ws;
  }

  // ── X2 ────────────────────────────────────────────────────────────────────
  it("X2: a refused register does not disarm the spawn watchdog for its token", async () => {
    const { port } = await start();

    const a = await client(port);
    a.send(JSON.stringify({ type: "session_register", sessionId: "S", cwd: "/w/a", source: "tui", pid: 1111 }));
    await delay(200);

    // The duplicate's spawn is armed and still pending.
    watchdog.arm({ cwd: "/w/dup", mechanism: "headless", pid: 9999, spawnToken: "TOKEN-DUP" });

    // It registers the already-held id and loses.
    const b = await client(port);
    const closed = new Promise<void>((r) => b.on("close", () => r()));
    b.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "S",
        cwd: "/w/dup",
        source: "tui",
        pid: 9999,
        spawnToken: "TOKEN-DUP",
      }),
    );
    await closed;

    // The watchdog was NOT cleared by the refused register, so it fires and
    // reclaims the duplicate's pi by its server-minted token.
    await until(() => killed.includes(9999), 9000);
  }, 25000);

  // ── X6 ────────────────────────────────────────────────────────────────────
  it("X6: an id-change contention is decided before the watchdog is cleared by cwd", async () => {
    const { port } = await start();

    // Two live sockets, each owning its own id.
    const a = await client(port);
    a.send(JSON.stringify({ type: "session_register", sessionId: "S2", cwd: "/w/incumbent", source: "tui", pid: 1111 }));
    await delay(200);

    const b = await client(port);
    b.send(JSON.stringify({ type: "session_register", sessionId: "S1", cwd: "/w/mover", source: "tui", pid: 2222 }));
    await delay(200);

    // A pending spawn in the SAME cwd the mover will report.
    watchdog.arm({ cwd: "/w/mover", mechanism: "headless", pid: 9999, spawnToken: "TOKEN-DUP" });

    // The mover now tries to take S2 — an id-change into a held, live id.
    const closed = new Promise<void>((r) => b.on("close", () => r()));
    b.send(JSON.stringify({ type: "session_register", sessionId: "S2", cwd: "/w/mover", source: "tui", pid: 2222 }));
    await closed;

    // The refusal short-circuited above `clearByCwd`, so the pending spawn's
    // watchdog is still armed and still reclaims.
    await until(() => killed.includes(9999), 9000);
  }, 25000);

  // ── X11 ───────────────────────────────────────────────────────────────────
  it("X11: a spawn armed with no browser WebSocket is still reclaimed on timeout", async () => {
    // No `ws` at all — the REST-resume shape that minted the incident.
    watchdog.arm({ cwd: "/w/restless", mechanism: "headless", pid: 9999, spawnToken: "TOKEN-DUP" });

    await until(() => killed.includes(9999), 9000);
  }, 25000);

  // ── X11 (entry-point coverage) ────────────────────────────────────────────
  it("X11: every continue-spawn entry point arms the watchdog", async () => {
    // D0/D2 name the entry points explicitly. The REST resume path is the one
    // that minted the incident's duplicate, and it has no browser socket — so
    // a `ws`-requiring arm silently skipped it.
    const { readFileSync } = await import("node:fs");
    const sites = [
      "packages/server/src/session/session-api.ts",
      "packages/server/src/server.ts",
      "packages/server/src/browser-handlers/session-action-handler.ts",
      // The bridge-initiated spawn uses the `.then()` form, which an
      // `await`-only pattern missed — that is exactly how the REST-resume gap
      // escaped the first pass.
      "packages/server/src/event-wiring.ts",
    ];
    for (const site of sites) {
      const src = readFileSync(new URL(`../../../../${site}`, import.meta.url), "utf-8");
      // Any call form, not just `await` — a `.then()` spawn is still a spawn.
      const spawns = (src.match(/(?<!function )spawnPiSession\(/g) ?? []).length;
      // Either the shared helper or the original inline `watchdog.arm(...)`
      // block counts — both leave the watchdog armed for the reclaim.
      const arms =
        (src.match(/armSpawnWatchdog\(/g) ?? []).length +
        (src.match(/watchdog\.arm\(/g) ?? []).length;
      expect(spawns, `${site} has spawn sites`).toBeGreaterThan(0);
      expect(arms, `${site} arms the watchdog for every spawn site`).toBeGreaterThanOrEqual(spawns);
    }
  }, 25000);

  it("X11: arming without a browser socket does not throw when the timeout fires", async () => {
    const errors: unknown[] = [];
    process.once("uncaughtException", (e) => errors.push(e));

    watchdog.arm({ cwd: "/w/quiet", mechanism: "headless", pid: 4321 });
    await delay(6000);

    expect(errors).toEqual([]);
  }, 25000);
});

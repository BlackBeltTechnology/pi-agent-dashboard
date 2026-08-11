/**
 * `shutdown` SHALL terminate the session's process for EVERY spawn strategy.
 *
 * The bug this pins (issue #452): `handleShutdown` asked the session to stop and
 * then reached only for headless-specific kill paths —
 * `headlessPidRegistry.killBySessionId` (registry lookup) and
 * `killHeadlessBySessionId` (a `findPidByMarker(sessionId)` command-line scan).
 * A tmux-spawned pane runs `cd <cwd> && pi`, which carries no session id, so the
 * scan returned `[]` and the registry had no entry. Nothing else tried, yet the
 * session was unregistered and `session_removed` broadcast regardless — so the
 * UI reported success while a ~127 MB `pi` kept running. Measured mid-run in the
 * E2E harness: 21 tmux panes = 21 resident `pi` = 0 session records.
 *
 * Meanwhile `handleForceKill` had always done the right thing:
 * `killProcess(session.pid, { timeoutMs: 2000 })`. The fix makes shutdown
 * escalate the same way.
 *
 * These use REAL processes, because the claim under test is "the process is
 * gone" — a mock could only prove that a function was called.
 *
 * See change: fix-tmux-session-shutdown-leak (test-plan #T1, #T2, #T5, #T6, #C2).
 */
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", () => resolve());
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

/** True while the PID is alive. `kill(pid, 0)` throws ESRCH once it is gone. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForDeath(pid: number, ms = 8000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await delay(100);
  }
  return false;
}

let server: DashboardServer;
let httpPort: number;
let piPort: number;
const spawnedPids: number[] = [];

/** A stand-in for a tmux-spawned `pi`: a real process the registry never sees. */
function spawnDetachedDummy(): number {
  const p = spawn("sleep", ["120"], { detached: true, stdio: "ignore" });
  p.unref();
  spawnedPids.push(p.pid!);
  return p.pid!;
}

/**
 * A process that deliberately IGNORES SIGTERM, so only the SIGKILL rung of the
 * ladder can end it. This is the fault injection behind test-plan #T4.
 */
function spawnSigtermIgnoringDummy(): number {
  const p = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
    { detached: true, stdio: "ignore" },
  );
  p.unref();
  spawnedPids.push(p.pid!);
  return p.pid!;
}

/**
 * Register a session over the bridge socket exactly as a tmux-spawned pi does:
 * carrying its `pid`, and WITHOUT any `headlessPidRegistry` entry.
 */
async function registerSession(sessionId: string, cwd: string, pid?: number) {
  const bridge = new WebSocket(`ws://127.0.0.1:${piPort}`);
  await waitForOpen(bridge);
  bridge.send(
    JSON.stringify({
      type: "session_register",
      sessionId,
      cwd,
      source: "tui",
      ...(pid === undefined ? {} : { pid }),
    }),
  );
  await delay(300);
  return bridge;
}

async function browserSocket(): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
  await waitForOpen(ws);
  await delay(100);
  return ws;
}

describe("shutdown terminates the session process for any spawn strategy (#452)", () => {
  beforeEach(async () => {
    server = await createServer({
      port: 0,
      piPort: 0,
      host: "127.0.0.1",
      dev: true,
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
    });
    await server.start();
    httpPort = server.httpPort()!;
    piPort = server.piPort()!;
  });

  afterEach(async () => {
    if (server) await server.stop();
    for (const pid of spawnedPids.splice(0)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  });

  it("T2/T1 — kills a session that is NOT in the headless registry (the tmux case)", async () => {
    const pid = spawnDetachedDummy();
    expect(isAlive(pid)).toBe(true);

    const bridge = await registerSession("tmux-session-1", "/test/tmux-cwd", pid);

    // The defining condition of the bug: no headless registry entry exists.
    expect(server.browserGateway.headlessPidRegistry.getPid("tmux-session-1")).toBeUndefined();

    // Close the bridge so the advisory `shutdown` message cannot be acted on by
    // a live pi — which is precisely when the escalation has to carry the load.
    bridge.close();
    await delay(200);

    const browser = await browserSocket();
    browser.send(JSON.stringify({ type: "shutdown", sessionId: "tmux-session-1" }));

    const died = await waitForDeath(pid);
    browser.close();

    expect(
      died,
      "the session's process survived shutdown — the UI reported success while a pi kept running (#452)",
    ).toBe(true);
  }, 20_000);

  it("T5 — shutting down twice, and after the process already exited, is safe", async () => {
    const pid = spawnDetachedDummy();
    const bridge = await registerSession("tmux-session-2", "/test/tmux-cwd-2", pid);
    bridge.close();
    await delay(200);

    const browser = await browserSocket();
    browser.send(JSON.stringify({ type: "shutdown", sessionId: "tmux-session-2" }));
    expect(await waitForDeath(pid)).toBe(true);

    // Second shutdown against an already-dead, already-unregistered session.
    browser.send(JSON.stringify({ type: "shutdown", sessionId: "tmux-session-2" }));
    await delay(500);

    // Nothing to assert beyond "the server is still serving": a repeat shutdown
    // must not throw or wedge the connection.
    expect(browser.readyState).toBe(WebSocket.OPEN);
    browser.close();
  }, 20_000);

  it("T4 — escalates to SIGKILL against a process that ignores SIGTERM", async () => {
    const pid = spawnSigtermIgnoringDummy();
    // Give node time to install the SIGTERM handler before anything signals it.
    await delay(500);
    expect(isAlive(pid)).toBe(true);

    const bridge = await registerSession("sigterm-ignorer", "/test/sigterm", pid);
    bridge.close();
    await delay(200);

    const browser = await browserSocket();
    const startedAt = Date.now();
    browser.send(JSON.stringify({ type: "shutdown", sessionId: "sigterm-ignorer" }));

    const died = await waitForDeath(pid, 12_000);
    const elapsed = Date.now() - startedAt;
    browser.close();

    expect(
      died,
      "a process that ignores SIGTERM survived shutdown — the ladder never reached SIGKILL",
    ).toBe(true);
    // Task 4.3 / design D3 risk: the confirmation wait is bounded by the
    // EXISTING ladder (1.5 s grace + 2 s SIGTERM window), not a second
    // independent timeout, so the worst case a stuck session can cost a suite
    // is ~3.5 s. Pinned generously to stay stable on a loaded CI box while
    // still failing loudly if an unbounded wait is ever introduced.
    expect(elapsed, "shutdown took longer than the ladder's own bound").toBeLessThan(8000);
  }, 30_000);

  it("C1 — session_removed is broadcast after termination, exactly once", async () => {
    const pid = spawnDetachedDummy();
    const bridge = await registerSession("confirm-first", "/test/confirm", pid);
    bridge.close();
    await delay(200);

    const browser = await browserSocket();
    let removedCount = 0;
    let aliveAtRemoval: boolean | undefined;
    browser.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === "session_removed" && m.sessionId === "confirm-first") {
        // Sampled at the instant the broadcast lands: the claim "removed" must
        // not precede the process actually being gone (#452 reported success
        // while a ~127 MB pi kept running).
        if (removedCount === 0) aliveAtRemoval = isAlive(pid);
        removedCount += 1;
      }
    });

    browser.send(JSON.stringify({ type: "shutdown", sessionId: "confirm-first" }));
    expect(await waitForDeath(pid)).toBe(true);
    await delay(1000);
    browser.close();

    expect(aliveAtRemoval, "session_removed was broadcast while the process was still alive").toBe(
      false,
    );
    expect(removedCount, "session_removed was not broadcast exactly once").toBe(1);
  }, 30_000);

  it("7.4 — the REST shutdown route terminates the process too, not just the WS one", async () => {
    // `POST /api/session/:id/shutdown` used to be a PARALLEL implementation:
    // headless-only kill, unconditional unregister + broadcast, and no
    // `closedReason:"manual"` liveness write (#449). Once the WS path learned to
    // terminate any spawn strategy, REST kept leaking a tmux-spawned pi exactly
    // as the WS path used to. It now delegates to the same body.
    const pid = spawnDetachedDummy();
    const bridge = await registerSession("rest-shutdown", "/test/rest", pid);
    bridge.close();
    await delay(200);

    const res = await fetch(`http://127.0.0.1:${httpPort}/api/session/rest-shutdown/shutdown`, {
      method: "POST",
    });
    expect(res.ok).toBe(true);

    expect(
      await waitForDeath(pid),
      "the REST route reported success while the session's process kept running",
    ).toBe(true);
  }, 20_000);

  it("C2 — a session with no known PID is still removed, without claiming a kill", async () => {
    const bridge = await registerSession("no-pid-session", "/test/no-pid");
    bridge.close();
    await delay(200);

    const browser = await browserSocket();
    const removed = new Promise<boolean>((resolve) => {
      const h = (raw: unknown) => {
        const m = JSON.parse(String(raw));
        if (m.type === "session_removed" && m.sessionId === "no-pid-session") {
          browser.off("message", h);
          resolve(true);
        }
      };
      browser.on("message", h);
      setTimeout(() => resolve(false), 6000);
    });

    browser.send(JSON.stringify({ type: "shutdown", sessionId: "no-pid-session" }));

    // Degrades to today's behaviour: there is no process to kill, so the session
    // is still released rather than being wedged forever.
    expect(await removed).toBe(true);
    browser.close();
  }, 20_000);
});

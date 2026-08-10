/**
 * End-to-end Tier-1 smoke for change: fix-keeper-kill-escalation §6.5–§6.7.
 *
 * Covers the kill chain from browser-protocol WS → handleShutdown /
 * handleForceKill → headlessPidRegistry.killBySessionId → killProcess ladder
 * → real keeper.cjs subprocess → real hung mock-pi child.
 *
 * Skips the literal "click button" step (covered by Tier 2 browser tests).
 *
 * Boots a real DashboardServer in-process; spawns a real keeper subprocess
 * against the `MOCK_PI_MODE=hung` mock-pi fixture (traps SIGTERM, ignores
 * stdin EOF, busy-loops). Registers the entry in headlessPidRegistry to
 * mimic post-bridge-connect state, then drives shutdown / force_kill via
 * the browser WS and asserts the hung pi dies within the ladder window.
 *
 * Unix-only: relies on POSIX signals + sockets. Windows verification per §6.8.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";
import { isProcessAlive } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";

const KEEPER_PATH = path.resolve(__dirname, "..", "rpc-keeper", "keeper.cjs");
const FIXTURES_DIR = path.resolve(__dirname, "..", "rpc-keeper", "__tests__", "fixtures");

// Distinct port pair per test file to avoid collisions with other integration
// suites (headless-shutdown-fallback uses 19190/19191, recovery-server uses
// 19180/19181, etc.).
const HTTP_PORT = 19200;
const PI_PORT = 19201;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeShortHome(): string {
  // Keep total UDS path well under macOS' 104-byte sun_path limit.
  return mkdtempSync(path.join("/tmp", "p"));
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", () => resolve());
    ws.on("error", reject);
    setTimeout(() => reject(new Error("ws open timeout")), 3000);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await delay(intervalMs);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

interface HungSession {
  keeper: ChildProcess;
  keeperPid: number;
  piPid: number;
  sockPath: string;
  sessionId: string;
  home: string;
  piPidFile: string;
}

/**
 * Spawn a real keeper.cjs subprocess wired to a hung mock-pi child.
 * Resolves once mock-pi has written its PID file (proves it's started + hung).
 */
async function spawnHungSession(): Promise<HungSession> {
  const sessionId = `e2e${Math.floor(Math.random() * 1e9).toString(36)}`;
  const home = makeShortHome();
  const sessionsDir = path.join(home, ".pi", "dashboard", "sessions");
  mkdirSync(sessionsDir, { recursive: true });

  // PATH shim so the keeper's bare `spawn("pi", …)` falls through to mock-pi.
  // (The keeper also accepts PI_KEEPER_PI_CMD; we use the PATH shim to mirror
  // the existing keeper.test.ts harness pattern.)
  const tmpBin = path.join(home, "bin");
  mkdirSync(tmpBin, { recursive: true });
  const shimSrc = path.join(FIXTURES_DIR, "mock-pi-shim.sh");
  const piShim = path.join(tmpBin, "pi");
  writeFileSync(piShim, readFileSync(shimSrc, "utf8"), { mode: 0o755 });

  const sockPath = path.join(sessionsDir, `${sessionId}.rpc.sock`);
  const piPidFile = path.join(sessionsDir, `mock-pi-${sessionId}.pid`);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PATH: `${tmpBin}${path.delimiter}${process.env.PATH ?? ""}`,
    MOCK_PI_CJS_PATH: path.join(FIXTURES_DIR, "mock-pi.cjs"),
    MOCK_PI_LOG: path.join(sessionsDir, `mock-pi-${sessionId}.log`),
    MOCK_PI_MODE: "hung",
    MOCK_PI_PID_FILE: piPidFile,
  };

  const keeper = spawn(process.execPath, [KEEPER_PATH, sessionId], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (process.env.KEEPER_TEST_DEBUG) {
    keeper.stderr?.on("data", (b) => process.stderr.write(`[keeper:${sessionId}] ${b}`));
  }

  // Wait for hung mock-pi to register itself.
  await waitFor(() => existsSync(piPidFile), 3000);
  const piPid = Number(readFileSync(piPidFile, "utf8").trim());
  if (!Number.isFinite(piPid) || piPid <= 0) {
    throw new Error(`invalid mock-pi pid: ${piPid}`);
  }
  if (!isProcessAlive(piPid)) {
    throw new Error(`mock-pi pid ${piPid} not alive at registration`);
  }

  return {
    keeper,
    keeperPid: keeper.pid!,
    piPid,
    sockPath,
    sessionId,
    home,
    piPidFile,
  };
}

function killAlive(pid: number): void {
  try { if (isProcessAlive(pid)) process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
}

describe("Session kill e2e (fix-keeper-kill-escalation)", () => {
  let server: DashboardServer | undefined;
  let session: HungSession | undefined;

  beforeEach(async () => {
    server = await createServer({
      port: HTTP_PORT,
      piPort: PI_PORT,
      host: "127.0.0.1",
      dev: true,
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
    });
    await server.start();
  });

  afterEach(async () => {
    // Belt-and-braces cleanup: kill any survivors before tearing down server.
    if (session) {
      killAlive(session.piPid);
      killAlive(session.keeperPid);
      session = undefined;
    }
    if (server) {
      await server.stop();
      server = undefined;
    }
  });

  // POSIX signals + UDS only. Windows path uses TerminateProcess; §6.8 manual.
  const itUnix = process.platform === "win32" ? it.skip : it;

  itUnix("Shutdown (browser WS) escalates hung pi via SIGKILL within ~2 s", async () => {
    session = await spawnHungSession();

    // Mimic post-spawn / post-bridge-connect state: register the keeper-mediated
    // entry with keeperPid + sockPath, then linkByToken with the pi PID.
    // This is the same shape spawnHeadlessViaKeeper + bridge handshake produces.
    const registry = server!.browserGateway.headlessPidRegistry;
    registry.register(session.keeperPid, "/e2e/cwd", session.keeper, "tok_e2e", {
      keeperPid: session.keeperPid,
      keeperSockPath: session.sockPath,
    });
    registry.linkByToken("tok_e2e", session.sessionId, session.piPid);
    expect(registry.getPid(session.sessionId)).toBe(session.piPid);

    // Sanity: hung pi is alive before kill.
    expect(isProcessAlive(session.piPid)).toBe(true);

    // Drive Shutdown via browser WS (same message handleShutdown receives in prod).
    const browser = new WebSocket(`ws://127.0.0.1:${HTTP_PORT}/ws`);
    await waitForOpen(browser);
    browser.send(JSON.stringify({ type: "shutdown", sessionId: session.sessionId }));

    // killProcess ladder: SIGTERM → poll every 200 ms → SIGKILL at 2 s.
    // Hung pi traps SIGTERM, so it must die from SIGKILL near the deadline.
    // Allow 3 s grace for the full ladder + handler dispatch.
    const t0 = Date.now();
    await waitFor(() => !isProcessAlive(session!.piPid), 3000, 50);
    const elapsed = Date.now() - t0;

    expect(isProcessAlive(session.piPid)).toBe(false);
    // Sanity: ladder took ≥ ~2 s (proves SIGKILL escalation fired, not a fluke
    // pi-cooperative exit). 1.8 s lower bound absorbs timing jitter.
    expect(elapsed).toBeGreaterThanOrEqual(1800);

    // Registry entry cleared.
    expect(registry.getPid(session.sessionId)).toBeUndefined();

    browser.close();
  }, 15_000);

  itUnix("force_kill (browser WS) escalates hung pi via SIGKILL", async () => {
    session = await spawnHungSession();

    const registry = server!.browserGateway.headlessPidRegistry;
    registry.register(session.keeperPid, "/e2e/cwd", session.keeper, "tok_fk", {
      keeperPid: session.keeperPid,
      keeperSockPath: session.sockPath,
    });
    registry.linkByToken("tok_fk", session.sessionId, session.piPid);

    // handleForceKill needs a SessionManager entry to mutate (status="ended"
    // broadcast). Register a minimal one so the handler completes its
    // post-kill bookkeeping without throwing.
    server!.sessionManager.register({
      id: session.sessionId,
      cwd: "/e2e/cwd",
      source: "tui",
      pid: session.piPid,
    });

    expect(isProcessAlive(session.piPid)).toBe(true);

    const browser = new WebSocket(`ws://127.0.0.1:${HTTP_PORT}/ws`);
    await waitForOpen(browser);
    browser.send(JSON.stringify({
      type: "force_kill",
      sessionId: session.sessionId,
    }));

    // handleForceKill drives BOTH killProcess(session.pid) AND
    // killBySessionId (which also routes through killProcess). The hung pi
    // dies near the 2 s ladder deadline.
    await waitFor(() => !isProcessAlive(session!.piPid), 3000, 50);
    expect(isProcessAlive(session.piPid)).toBe(false);

    browser.close();
  }, 15_000);
});

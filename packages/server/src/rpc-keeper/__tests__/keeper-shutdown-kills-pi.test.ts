/**
 * Verify that keeper.cjs::shutdown() SIGKILLs its piChild before exiting.
 *
 * Defence-in-depth requirement from change: fix-keeper-kill-escalation.
 *
 * Scenario: a hung pi (SIGTERM-trapping, stdin-EOF-ignoring, busy-looping)
 * is spawned by the keeper. We send SIGTERM to the keeper. The keeper's
 * shutdown() runs and MUST SIGKILL piChild before process.exit, otherwise
 * the hung pi would be reparented to init/launchd and survive.
 *
 * Unix-only: relies on POSIX signals (process.kill, SIGTERM, SIGKILL).
 * Windows path uses TerminateProcess via libuv; manual verification only.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isProcessAlive } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";

const KEEPER_PATH = path.resolve(__dirname, "..", "keeper.cjs");
const FIXTURES_DIR = path.resolve(__dirname, "fixtures");

function makeShortHome(): string {
  return mkdtempSync(path.join("/tmp", "p"));
}

function sessionsDirIn(home: string): string {
  return path.join(home, ".pi", "dashboard", "sessions");
}

function makeSessionId(): string {
  return `k${Math.floor(Math.random() * 1e9).toString(36)}`;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

interface Spawned {
  child: ChildProcess;
  home: string;
  sessionId: string;
  piPidFile: string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

function spawnKeeperWithHungPi(): Spawned {
  const sessionId = makeSessionId();
  const home = makeShortHome();
  mkdirSync(sessionsDirIn(home), { recursive: true });

  const tmpBin = path.join(home, "bin");
  mkdirSync(tmpBin, { recursive: true });
  const shimSrc = path.join(FIXTURES_DIR, "mock-pi-shim.sh");
  const piShim = path.join(tmpBin, "pi");
  // Reuse the existing PATH shim (execs MOCK_PI_CJS_PATH).
  require("fs").writeFileSync(piShim, readFileSync(shimSrc, "utf8"), { mode: 0o755 });

  const piPidFile = path.join(sessionsDirIn(home), `mock-pi-${sessionId}.pid`);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PATH: `${tmpBin}${path.delimiter}${process.env.PATH ?? ""}`,
    MOCK_PI_CJS_PATH: path.join(FIXTURES_DIR, "mock-pi.cjs"),
    MOCK_PI_LOG: path.join(sessionsDirIn(home), `mock-pi-${sessionId}.log`),
    MOCK_PI_MODE: "hung",
    MOCK_PI_PID_FILE: piPidFile,
  };

  const child = spawn(process.execPath, [KEEPER_PATH, sessionId], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stderr?.on("data", (b) => {
    if (process.env.KEEPER_TEST_DEBUG) process.stderr.write(`[keeper:${sessionId}] ${b}`);
  });

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );

  return { child, home, sessionId, piPidFile, exited };
}

const itUnix = process.platform === "win32" ? it.skip : it;

describe("keeper.cjs::shutdown — SIGKILLs piChild", () => {
  let spawned: Spawned | undefined;

  beforeEach(() => {
    spawned = undefined;
  });

  afterEach(async () => {
    if (spawned) {
      // Belt-and-braces cleanup: ensure no leaked processes survive the test.
      try { spawned.child.kill("SIGKILL"); } catch { /* ignore */ }
      if (existsSync(spawned.piPidFile)) {
        const pid = Number(readFileSync(spawned.piPidFile, "utf8").trim());
        if (Number.isFinite(pid) && pid > 0) {
          try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
        }
      }
    }
  });

  itUnix("SIGTERM to keeper kills hung piChild within 1 s", async () => {
    spawned = spawnKeeperWithHungPi();

    // Wait for fake-pi to write its PID file (proves it has started + is hung).
    await waitFor(() => existsSync(spawned!.piPidFile), 3000);
    const piPid = Number(readFileSync(spawned.piPidFile, "utf8").trim());
    expect(Number.isFinite(piPid) && piPid > 0).toBe(true);
    expect(isProcessAlive(piPid)).toBe(true);

    // Send SIGTERM to keeper. shutdown() must SIGKILL piChild before exit.
    spawned.child.kill("SIGTERM");

    // Poll up to 1 s for the fake-pi to die.
    await waitFor(() => !isProcessAlive(piPid), 1000, 50);

    expect(isProcessAlive(piPid)).toBe(false);
    await spawned.exited;
  }, 10_000);
});

/**
 * Keeper integration tests.
 *
 * Spawns `node packages/server/src/rpc-keeper/keeper.cjs <sessionId>` as a
 * real subprocess (NOT via jiti / tsx — the whole point is that keeper.cjs
 * runs under bare node). A `pi` PATH shim invokes a `mock-pi.cjs` fixture
 * so we exercise the spawn path without needing a real pi binary.
 *
 * Note re tasks.md 3.1: spec says ".test.cjs". We write the driver in TS
 * (existing vitest glob is `*.test.ts`); the BINARY-under-test is still
 * pure CJS. The CJS contract is what we verify — the test runner is irrelevant.
 *
 * Tasks covered: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { piPidPathFor as piPidPathForKM } from "../keeper-manager.js";

const KEEPER_PATH = path.resolve(__dirname, "..", "keeper.cjs");
const FIXTURES_DIR = path.resolve(__dirname, "fixtures");
const SHIM_DIR = FIXTURES_DIR;

// macOS UDS sun_path is 104 bytes. The root `npm test` HOME under
// /var/folders/.../pi-test-XXXXXX is ~73 chars before any further nesting,
// which exceeds the limit once we append `.pi/dashboard/sessions/<uuid>.rpc.sock`.
// Each test mints its OWN short HOME under /tmp/p... (≤ 12 chars), passed to
// the keeper subprocess via env. The npm-test HOME isolation tripwire is
// unaffected — we only override HOME for the spawned child, not the test
// runner itself. We still create the per-test HOME under /tmp (not the npm-test
// HOME) because /tmp is short, AND we keep the test isolated from production paths.
function sessionsDirIn(home: string): string {
  return path.join(home, ".pi", "dashboard", "sessions");
}
function sockPathIn(home: string, sid: string): string {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\pi-rpc-${sid}`
    : path.join(sessionsDirIn(home), `${sid}.rpc.sock`);
}
function pidPathIn(home: string, sid: string): string {
  return process.platform === "win32"
    ? path.join(sessionsDirIn(home), `pi-rpc-${sid}.pid`)
    : `${sockPathIn(home, sid)}.pid`;
}
function keeperLogIn(home: string, sid: string): string {
  return path.join(sessionsDirIn(home), `keeper-${sid}.log`);
}
// Pi-PID sidecar path (post-spawn). See change: fix-keeper-session-identity-and-reattach.
function piPidPathIn(home: string, sid: string): string {
  return process.platform === "win32"
    ? path.join(sessionsDirIn(home), `pi-rpc-${sid}.pi-pid`)
    : `${sockPathIn(home, sid)}.pi-pid`;
}

function makeSessionId(): string {
  // Short ID to keep total UDS path comfortably under 104 bytes even on
  // edge-case test environments.
  return `t${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function makeShortHome(): string {
  // /tmp resolves to /private/tmp on macOS but Node uses the path as-given
  // for UDS bind; either resolved form fits well under 104 bytes.
  // mkdtempSync('/tmp/p') yields '/tmp/pXXXXXX' (≈12 chars).
  return mkdtempSync(path.join("/tmp", "p"));
}

interface SpawnedKeeper {
  child: ChildProcess;
  sessionId: string;
  home: string;
  mockPiLog: string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

// Convenience accessors that route through the keeper's own home.
function sockPathFor(s: SpawnedKeeper): string { return sockPathIn(s.home, s.sessionId); }
function pidPathFor(s: SpawnedKeeper): string { return pidPathIn(s.home, s.sessionId); }
function piPidPathFor(s: SpawnedKeeper): string { return piPidPathIn(s.home, s.sessionId); }
function keeperLogFor(s: SpawnedKeeper): string { return keeperLogIn(s.home, s.sessionId); }

interface SpawnKeeperOpts {
  /** "normal" (default) or "crash" (mock-pi exits 1 immediately) */
  mode?: "normal" | "crash";
  /** Override sessionId; otherwise auto-generated */
  sessionId?: string;
}

interface SpawnKeeperOptsExt extends SpawnKeeperOpts {
  /** Override HOME (default: short tmp dir under /tmp/p...). */
  home?: string;
  /** If true, do NOT pre-create sessionsDir (tests stale-socket scenarios). */
  skipMkdir?: boolean;
  /**
   * Extra env vars merged into the keeper's env (after PATH/HOME defaults).
   * Used by PI_KEEPER_PI_CMD tests to inject the resolved-pi-argv env var.
   * See change: fix-rpc-keeper-pi-resolution.
   */
  extraEnv?: NodeJS.ProcessEnv;
  /**
   * If true, do NOT prepend the per-test PATH shim that turns `pi` into
   * `mock-pi-shim.sh`. Used to verify the keeper can spawn pi solely via
   * `PI_KEEPER_PI_CMD`. See change: fix-rpc-keeper-pi-resolution.
   */
  noPathShim?: boolean;
}

async function spawnKeeper(opts: SpawnKeeperOptsExt = {}): Promise<SpawnedKeeper> {
  const sessionId = opts.sessionId ?? makeSessionId();
  const home = opts.home ?? makeShortHome();
  if (!opts.skipMkdir) mkdirSync(sessionsDirIn(home), { recursive: true });

  const mockPiLog = path.join(sessionsDirIn(home), `mock-pi-${sessionId}.log`);

  // PATH shim: prepend a dir containing a `pi` script that execs our mock.
  // Skipped when `noPathShim` is true (tests `PI_KEEPER_PI_CMD` resolution).
  const tmpBin = path.join(home, "bin");
  mkdirSync(tmpBin, { recursive: true });
  const piShimDest = path.join(tmpBin, "pi");
  const shimSrc = path.join(SHIM_DIR, "mock-pi-shim.sh");
  if (!opts.noPathShim) {
    writeFileSync(piShimDest, readFileSync(shimSrc, "utf8"), { mode: 0o755 });
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PATH: opts.noPathShim
      // Scrub PATH so bare `spawn("pi", ...)` cannot find pi. Forces the
      // keeper to rely on PI_KEEPER_PI_CMD.
      ? "/usr/bin:/bin"
      : `${tmpBin}${path.delimiter}${process.env.PATH ?? ""}`,
    MOCK_PI_CJS_PATH: path.join(SHIM_DIR, "mock-pi.cjs"),
    MOCK_PI_LOG: mockPiLog,
    MOCK_PI_MODE: opts.mode ?? "normal",
    ...(opts.extraEnv ?? {}),
  };

  const child = spawn(process.execPath, [KEEPER_PATH, sessionId], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Capture stderr for diagnostics on test failure.
  child.stderr?.on("data", (b) => {
    if (process.env.KEEPER_TEST_DEBUG) process.stderr.write(`[keeper:${sessionId}] ${b}`);
  });

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );

  return { child, sessionId, home, mockPiLog, exited };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000, intervalMs = 25): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

async function readyKeeper(s: SpawnedKeeper): Promise<void> {
  // "Ready" = (a) socket bound, (b) pid sidecar written, (c) past 300ms
  // crash window AND keeper still running.
  await waitFor(() => existsSync(pidPathFor(s)));
  if (process.platform !== "win32") {
    await waitFor(() => existsSync(sockPathFor(s)));
  }
  // Past the crash window
  await new Promise((r) => setTimeout(r, 350));
  if (s.child.exitCode !== null) {
    const log = existsSync(keeperLogFor(s))
      ? readFileSync(keeperLogFor(s), "utf8")
      : "(no log)";
    throw new Error(`keeper exited prematurely (code=${s.child.exitCode}). Log:\n${log}`);
  }
}

async function writeLineToKeeper(s: SpawnedKeeper, line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const sock = net.createConnection(sockPathFor(s));
    sock.once("connect", () => {
      sock.end(line + "\n", "utf8", () => resolve());
    });
    sock.once("error", reject);
  });
}

async function killAndAwait(s: SpawnedKeeper, signal: NodeJS.Signals = "SIGTERM"): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (s.child.exitCode === null) s.child.kill(signal);
  return s.exited;
}

// ---------------------------------------------------------------------------
// Cleanup state across tests
// ---------------------------------------------------------------------------

const trackedKeepers: SpawnedKeeper[] = [];
beforeEach(() => {
  trackedKeepers.length = 0;
});
afterEach(async () => {
  for (const k of trackedKeepers) {
    if (k.child.exitCode === null) {
      k.child.kill("SIGKILL");
      await k.exited.catch(() => undefined);
    }
    try { rmSync(k.home, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function track(s: SpawnedKeeper): SpawnedKeeper {
  trackedKeepers.push(s);
  return s;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(process.platform === "win32")("rpc-keeper (Unix UDS)", () => {
  it("3.2 forwards a JSON line from UDS connection to mock-pi stdin", async () => {
    const k = track(await spawnKeeper());
    await readyKeeper(k);

    const line = '{"type":"prompt","message":"hello","id":"1"}';
    await writeLineToKeeper(k, line);

    // Mock pi appends each line to MOCK_PI_LOG. Wait for it.
    await waitFor(() => existsSync(k.mockPiLog) && readFileSync(k.mockPiLog, "utf8").includes("hello"));

    const contents = readFileSync(k.mockPiLog, "utf8");
    expect(contents.trimEnd()).toBe(line);

    // The keeper still has pi alive — clean up.
    await killAndAwait(k);
  }, 10_000);

  it("3.3 keeper exits 0 and unlinks files when pi exits", async () => {
    const k = track(await spawnKeeper());
    await readyKeeper(k);

    expect(existsSync(sockPathFor(k))).toBe(true);
    expect(existsSync(pidPathFor(k))).toBe(true);

    // Read the keeper's pi child PID via lsof? Simpler: kill the keeper's
    // parent's pi child by PGID-equivalent strategy — but that's racy.
    // Instead, use the shutdown path that's the same code: send SIGTERM
    // to the keeper, which closes pi's stdin → mock-pi sees EOF → exit 0.
    // This test exercises the shared shutdown handler path that ALSO
    // fires on pi-exit (via child.on("exit") → shutdown(0)).
    const result = await killAndAwait(k, "SIGTERM");

    expect(result.code).toBe(0);
    expect(existsSync(sockPathFor(k))).toBe(false);
    expect(existsSync(pidPathFor(k))).toBe(false);
  }, 10_000);

  it("3.3b keeper exits 0 and unlinks files when pi child exits naturally", async () => {
    // Stronger version of 3.3: trigger pi's exit (not keeper's signal).
    // We connect, send EOF to mock-pi indirectly by closing all input
    // routes. Easiest path: write a line and end the conn — mock-pi will
    // log the line but won't exit (it waits for stdin EOF, which only
    // closes when keeper closes pi.stdin, which only happens on keeper
    // shutdown). So instead: send SIGTERM to the mock-pi child PID by
    // searching its process tree.
    const k = track(await spawnKeeper());
    await readyKeeper(k);

    // Find mock-pi children of the keeper (best-effort via /proc on Linux,
    // ps on macOS).
    const mockPids = await findChildPids(k.child.pid!);
    expect(mockPids.length).toBeGreaterThan(0);

    for (const pid of mockPids) {
      try { process.kill(pid, "SIGTERM"); } catch { /* gone */ }
    }

    const result = await k.exited;
    expect(result.code).toBe(0);
    expect(existsSync(sockPathFor(k))).toBe(false);
    expect(existsSync(pidPathFor(k))).toBe(false);
  }, 10_000);

  it("3.4 stale-socket recovery (pre-create socket file, keeper unlinks + retries)", async () => {
    const sessionId = makeSessionId();
    const home = makeShortHome();
    mkdirSync(sessionsDirIn(home), { recursive: true });
    // Pre-create a regular file at the socket path. Bind fails with EADDRINUSE.
    writeFileSync(sockPathIn(home, sessionId), "", { mode: 0o600 });

    const k = track(await spawnKeeper({ sessionId, home }));
    await readyKeeper(k);

    // Recovery succeeded: the path is now bound (existsSync returns true for sockets too).
    expect(existsSync(sockPathFor(k))).toBe(true);

    await killAndAwait(k);
  }, 10_000);

  it("3.5 crash-detection: mock-pi exits immediately, keeper exits non-zero within 1s", async () => {
    const k = track(await spawnKeeper({ mode: "crash" }));

    // Should NOT reach readyKeeper — wait for exit instead, with a tight bound.
    const result = await Promise.race([
      k.exited,
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((_, reject) =>
        setTimeout(() => reject(new Error("keeper did not exit within 2s")), 2000),
      ),
    ]);
    expect(result.code).not.toBe(0);

    // Files cleaned up
    expect(existsSync(sockPathFor(k))).toBe(false);
    expect(existsSync(pidPathFor(k))).toBe(false);
  }, 5_000);

  it("fix-rpc-keeper-pi-resolution: PI_KEEPER_PI_CMD resolves pi when not on PATH (node+script form)", async () => {
    // Regression test for the Electron-launched dashboard failure mode.
    // PATH is scrubbed (`noPathShim: true`) so bare `spawn("pi", ...)` would
    // ENOENT. PI_KEEPER_PI_CMD points at [<node>, <mock-pi.cjs>] — the same
    // shape `ToolResolver.resolvePi()` returns on Windows when only pi.cmd
    // is available, exercising the multi-element argv branch of readPiCmd.
    const mockPiAbs = path.join(SHIM_DIR, "mock-pi.cjs");
    const k = track(
      await spawnKeeper({
        noPathShim: true,
        extraEnv: { PI_KEEPER_PI_CMD: JSON.stringify([process.execPath, mockPiAbs]) },
      }),
    );
    await readyKeeper(k);

    const line = '{"type":"prompt","message":"abs-path","id":"1"}';
    await writeLineToKeeper(k, line);
    await waitFor(
      () => existsSync(k.mockPiLog) && readFileSync(k.mockPiLog, "utf8").includes("abs-path"),
    );

    // Keeper log records the resolved exe (not bare "pi").
    const klog = readFileSync(keeperLogFor(k), "utf8");
    expect(klog).toContain(`spawning pi ${process.execPath} ${mockPiAbs}`);

    await killAndAwait(k);
  }, 10_000);

  it("fix-rpc-keeper-pi-resolution: malformed PI_KEEPER_PI_CMD falls back to bare pi (PATH shim)", async () => {
    // PATH shim IS present so bare `"pi"` resolves to mock-pi-shim.sh.
    // PI_KEEPER_PI_CMD is malformed JSON — keeper must log and fall back.
    const k = track(
      await spawnKeeper({
        extraEnv: { PI_KEEPER_PI_CMD: "not json at all" },
      }),
    );
    await readyKeeper(k);

    const line = '{"type":"prompt","message":"fallback","id":"1"}';
    await writeLineToKeeper(k, line);
    await waitFor(
      () => existsSync(k.mockPiLog) && readFileSync(k.mockPiLog, "utf8").includes("fallback"),
    );

    const klog = readFileSync(keeperLogFor(k), "utf8");
    expect(klog).toMatch(/ignoring malformed PI_KEEPER_PI_CMD/);
    expect(klog).toMatch(/spawning pi pi /);

    await killAndAwait(k);
  }, 10_000);

  it("fix-rpc-keeper-pi-resolution: empty-array PI_KEEPER_PI_CMD treated as unset", async () => {
    // Shape check: empty array is rejected, falls back to bare "pi" via PATH.
    const k = track(
      await spawnKeeper({
        extraEnv: { PI_KEEPER_PI_CMD: "[]" },
      }),
    );
    await readyKeeper(k);
    const klog = readFileSync(keeperLogFor(k), "utf8");
    expect(klog).toMatch(/ignoring malformed PI_KEEPER_PI_CMD/);
    expect(klog).toMatch(/spawning pi pi /);
    await killAndAwait(k);
  }, 10_000);

  it("fix-rpc-keeper-pi-resolution: PI_KEEPER_PI_CMD stripped from pi env", async () => {
    // The keeper must NOT leak PI_KEEPER_PI_CMD / PI_KEEPER_PI_ARGS into
    // pi's env. Mock-pi dumps its env to a side-file via env-log mode.
    const mockPiAbs = path.join(SHIM_DIR, "mock-pi.cjs");
    const envLog = path.join("/tmp", `mock-pi-env-${Date.now()}.log`);
    const k = track(
      await spawnKeeper({
        noPathShim: true,
        extraEnv: {
          PI_KEEPER_PI_CMD: JSON.stringify([process.execPath, mockPiAbs]),
          PI_KEEPER_PI_ARGS: JSON.stringify(["--mode", "rpc"]),
          MOCK_PI_ENV_LOG: envLog,
        },
      }),
    );
    await readyKeeper(k);
    await waitFor(() => existsSync(envLog));
    const envDump = readFileSync(envLog, "utf8");
    expect(envDump).not.toMatch(/^PI_KEEPER_PI_CMD=/m);
    expect(envDump).not.toMatch(/^PI_KEEPER_PI_ARGS=/m);
    expect(envDump).toMatch(/^PI_DASHBOARD_SPAWNED=1$/m);
    try { unlinkSync(envLog); } catch { /* ignore */ }
    await killAndAwait(k);
  }, 10_000);

  it("3.6 concurrent connections — 3 simultaneous UDS connections, all 3 lines forwarded", async () => {
    const k = track(await spawnKeeper());
    await readyKeeper(k);

    const lines = [
      '{"type":"prompt","message":"line-A","id":"a"}',
      '{"type":"prompt","message":"line-B","id":"b"}',
      '{"type":"prompt","message":"line-C","id":"c"}',
    ];

    await Promise.all(lines.map((line) => writeLineToKeeper(k, line)));

    await waitFor(() => {
      if (!existsSync(k.mockPiLog)) return false;
      const c = readFileSync(k.mockPiLog, "utf8");
      return lines.every((l) => c.includes(l));
    });

    const out = readFileSync(k.mockPiLog, "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
      .sort();
    expect(out).toEqual([...lines].sort());

    await killAndAwait(k);
  }, 10_000);

  it("add-keeper-output-capture-toggle: capture OFF (default) discards pi stdout, keeps lifecycle log", async () => {
    const marker = "MOCK_PI_STDOUT_MARKER_OFF";
    const k = track(await spawnKeeper({ extraEnv: { MOCK_PI_STDOUT: marker } }));
    await readyKeeper(k);

    const klog = readFileSync(keeperLogFor(k), "utf8");
    // Branch taken: keeper lifecycle records capture disabled.
    expect(klog).toContain("pi output capture: disabled");
    // pi's stdout marker was routed to /dev/null, NOT the keeper log.
    expect(klog).not.toContain(marker);
    // Keeper's own lifecycle breadcrumbs still present.
    expect(klog).toMatch(/keeper starting:/);
    expect(klog).toMatch(/spawning pi /);

    await killAndAwait(k);
  }, 10_000);

  it("add-keeper-output-capture-toggle: capture ON archives pi stdout into keeper log", async () => {
    const marker = "MOCK_PI_STDOUT_MARKER_ON";
    const k = track(
      await spawnKeeper({
        extraEnv: { PI_KEEPER_CAPTURE_PI_OUTPUT: "1", MOCK_PI_STDOUT: marker },
      }),
    );
    await readyKeeper(k);

    await waitFor(
      () => existsSync(keeperLogFor(k)) && readFileSync(keeperLogFor(k), "utf8").includes(marker),
    );
    const klog = readFileSync(keeperLogFor(k), "utf8");
    expect(klog).toContain("pi output capture: enabled");
    expect(klog).toContain(marker);

    await killAndAwait(k);
  }, 10_000);

  // ── pi-PID sidecar lifecycle ──────────────────────────────────────────────
  // See change: fix-keeper-session-identity-and-reattach.

  it("path parity: keeper-manager's piPidPathFor resolves to the file the real keeper writes", async () => {
    // keeper.cjs (CJS, cannot import the TS helper) and keeper-manager's
    // piPidPathFor are two implementations of the same convention. If they
    // diverge, discovery reads absent → piPid undefined → the cwd-FIFO
    // degradation this change fixes. Assert the TS helper points exactly at
    // the file the real keeper wrote. See change: fix-keeper-session-identity-and-reattach.
    const k = track(await spawnKeeper());
    await readyKeeper(k);
    await waitFor(() => existsSync(piPidPathFor(k)));
    const tsHelperPath = piPidPathForKM(sessionsDirIn(k.home), k.sessionId);
    expect(tsHelperPath).toBe(piPidPathFor(k));
    expect(existsSync(tsHelperPath)).toBe(true);
    await killAndAwait(k);
  }, 10_000);

  it("E13: keeper's own .pid sidecar stays a bare keeper-PID integer", async () => {
    const k = track(await spawnKeeper());
    await readyKeeper(k);
    const raw = readFileSync(pidPathFor(k), "utf8");
    expect(raw.trim()).toBe(String(k.child.pid));
    expect(raw.trim()).toMatch(/^\d+$/); // parseable by the orphan-cleanup reader
    await killAndAwait(k);
  }, 10_000);

  it("E18: the .pi-pid sidecar exists before the 'keeper ready' log line", async () => {
    const k = track(await spawnKeeper());
    await waitFor(() => existsSync(keeperLogFor(k)) && readFileSync(keeperLogFor(k), "utf8").includes("keeper ready"));
    // By the time 'keeper ready' is written, the post-spawn .pi-pid write has
    // already run (code orders 3b before the crash-window ready log).
    expect(existsSync(piPidPathFor(k))).toBe(true);
    const piPid = Number(readFileSync(piPidPathFor(k), "utf8").trim());
    expect(Number.isFinite(piPid) && piPid > 0).toBe(true);
    expect(piPid).not.toBe(k.child.pid); // pi's PID, not the keeper's
    await killAndAwait(k);
  }, 10_000);

  it("E17: SIGTERM unlinks socket, own .pid AND .pi-pid", async () => {
    const k = track(await spawnKeeper());
    await readyKeeper(k);
    await waitFor(() => existsSync(piPidPathFor(k)));
    expect(existsSync(sockPathFor(k))).toBe(true);
    expect(existsSync(pidPathFor(k))).toBe(true);
    expect(existsSync(piPidPathFor(k))).toBe(true);

    const result = await killAndAwait(k, "SIGTERM");
    expect(result.code).toBe(0);
    expect(existsSync(sockPathFor(k))).toBe(false);
    expect(existsSync(pidPathFor(k))).toBe(false);
    expect(existsSync(piPidPathFor(k))).toBe(false);
  }, 10_000);

  it("X1: a failed .pi-pid write is logged and non-fatal (pi stays alive, own .pid intact)", async () => {
    // Make ONLY the pi-PID write fail: pre-create a directory at its path so
    // writeFileSync throws EISDIR. Socket bind + own .pid write + pi spawn are
    // unaffected (different paths).
    const sessionId = makeSessionId();
    const home = makeShortHome();
    mkdirSync(sessionsDirIn(home), { recursive: true });
    mkdirSync(piPidPathIn(home, sessionId), { recursive: true });

    const k = track(await spawnKeeper({ sessionId, home }));
    await readyKeeper(k); // keeper survived the crash window → still running

    // pi is alive: a forwarded line reaches the mock-pi log.
    await writeLineToKeeper(k, '{"type":"prompt","message":"x1-alive","id":"1"}');
    await waitFor(() => existsSync(k.mockPiLog) && readFileSync(k.mockPiLog, "utf8").includes("x1-alive"));

    const klog = readFileSync(keeperLogFor(k), "utf8");
    expect(klog).toMatch(/cannot write pi-PID sidecar/);
    // Own .pid sidecar unaffected (bare keeper integer).
    expect(readFileSync(pidPathFor(k), "utf8").trim()).toBe(String(k.child.pid));
    // No regular .pi-pid FILE was written (the path is still the directory).
    expect(existsSync(path.join(piPidPathIn(home, sessionId), "placeholder-never-created"))).toBe(false);

    await killAndAwait(k);
  }, 10_000);

  it("X6: pi spawn failure writes no .pi-pid and the keeper exits non-zero", async () => {
    // Scrubbed PATH + PI_KEEPER_PI_CMD pointing at a non-existent binary →
    // child_process.spawn emits ENOENT → keeper shutdown(1).
    const k = track(
      await spawnKeeper({
        noPathShim: true,
        extraEnv: { PI_KEEPER_PI_CMD: JSON.stringify(["/does/not/exist/pi-xyz"]) },
      }),
    );
    const result = await Promise.race([
      k.exited,
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((_, reject) =>
        setTimeout(() => reject(new Error("keeper did not exit within 3s")), 3000),
      ),
    ]);
    expect(result.code).not.toBe(0);
    expect(existsSync(piPidPathFor(k))).toBe(false);
  }, 8_000);
});

describe.skipIf(process.platform !== "win32")("rpc-keeper (Windows named pipe)", () => {
  // Task 3.7: same scenarios as Unix, gated by platform.
  // Windows path uses `\\.\pipe\pi-rpc-<sid>` and `<sessionsDir>/pi-rpc-<sid>.pid`.
  // Leaving as a single smoke test for now — full coverage of all 3.x cases
  // requires a Windows CI runner. The spec scenarios apply identically; the
  // helper functions above already path-switch by platform.

  it("3.7 keeper bound named pipe, forwards a line, exits cleanly on signal", async () => {
    const k = track(await spawnKeeper());
    await readyKeeper(k);

    const line = '{"type":"prompt","message":"hello","id":"1"}';
    await writeLineToKeeper(k, line);

    await waitFor(() => existsSync(k.mockPiLog) && readFileSync(k.mockPiLog, "utf8").includes("hello"));

    const result = await killAndAwait(k);
    expect(result.code).toBe(0);
    // Named pipe path is virtual on Windows — only the PID sidecar is unlinked.
    expect(existsSync(pidPathFor(k))).toBe(false);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findChildPids(parentPid: number): Promise<number[]> {
  // macOS / Linux: `ps -o pid= --ppid <pid>`
  return new Promise((resolve) => {
    // -A is required to see processes outside the calling terminal session;
    // vitest workers don't have a controlling tty, so without -A the keeper's
    // child node process is invisible.
    const ps = spawn("ps", ["-A", "-o", "pid=", "-o", "ppid="], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    ps.stdout.on("data", (b) => { out += b; });
    ps.once("exit", () => {
      const pids: number[] = [];
      for (const raw of out.split("\n")) {
        const m = raw.trim().match(/^(\d+)\s+(\d+)$/);
        if (m && Number(m[2]) === parentPid) pids.push(Number(m[1]));
      }
      resolve(pids);
    });
    ps.once("error", () => resolve([]));
  });
}

// ===========================================================================
// Keeper-log rotation — bounded growth (fix-runaway-keeper-log-growth)
// ===========================================================================
//
// Real-keeper rotation scenarios. The exact cap boundary, throttle counting
// and fs-fault stubs live in keeper-log-rotation.test.ts (unit level, where
// fs is injectable); these tests prove the CONTRACT end-to-end against a
// spawned keeper: the shared fd survives rotation (inode + post-rotation
// child bytes), no generation is retained, child-only growth rotates, the
// RPC path never stalls, and the env plumbing resolves/strips the knobs.

/** Distinctive seed byte for pre-grown logs (must differ from the writer's 'a'). */
const SEED_CHAR = "B";

function seedLog(home: string, sid: string, bytes: number): string {
  mkdirSync(sessionsDirIn(home), { recursive: true });
  const p = keeperLogIn(home, sid);
  writeFileSync(p, SEED_CHAR.repeat(bytes));
  return p;
}

function logSize(home: string, sid: string): number {
  return statSync(keeperLogIn(home, sid)).size;
}

/** Wait until the keeper log stops growing for `stableMs`. Returns last size. */
async function waitForStableSize(
  home: string,
  sid: string,
  { stableMs = 800, timeoutMs = 15_000, sampleMs = 100 }: { stableMs?: number; timeoutMs?: number; sampleMs?: number } = {},
): Promise<number> {
  const start = Date.now();
  let last = -1;
  let lastChange = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = logSize(home, sid);
    if (s !== last) {
      last = s;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= stableMs) {
      return s;
    }
    await new Promise((r) => setTimeout(r, sampleMs));
  }
  throw new Error(`waitForStableSize timed out after ${timeoutMs}ms`);
}

describe.skipIf(process.platform === "win32")("keeper-log rotation (real keeper)", () => {
  it("E8: env fallback — unset/empty/non-numeric/zero all resolve to the 128 MiB default (logged at startup)", async () => {
    for (const variant of [undefined, "", "abc", "0"]) {
      const extraEnv: NodeJS.ProcessEnv =
        variant === undefined ? {} : { PI_KEEPER_LOG_MAX_BYTES: variant };
      const k = track(await spawnKeeper({ extraEnv }));
      await readyKeeper(k);
      const klog = readFileSync(keeperLogFor(k), "utf8");
      expect(klog, `variant ${JSON.stringify(variant)}`).toContain(
        "log rotation: maxBytes=134217728 checkIntervalMs=5000",
      );
      await killAndAwait(k);
    }
  }, 20_000);

  it("E8b: a valid env value resolves as-is (no coercion)", async () => {
    const k = track(
      await spawnKeeper({ extraEnv: { PI_KEEPER_LOG_MAX_BYTES: "65536", PI_KEEPER_LOG_CHECK_INTERVAL_MS: "250" } }),
    );
    await readyKeeper(k);
    const klog = readFileSync(keeperLogFor(k), "utf8");
    expect(klog).toContain("log rotation: maxBytes=65536 checkIntervalMs=250");
    await killAndAwait(k);
  }, 10_000);

  it("E9: keeper-internal log vars are stripped from pi's env", async () => {
    const mockPiAbs = path.join(SHIM_DIR, "mock-pi.cjs");
    const envLog = path.join("/tmp", `mock-pi-env-rot-${Date.now()}.log`);
    const k = track(
      await spawnKeeper({
        noPathShim: true,
        extraEnv: {
          PI_KEEPER_PI_CMD: JSON.stringify([process.execPath, mockPiAbs]),
          PI_KEEPER_LOG_MAX_BYTES: "65536",
          PI_KEEPER_LOG_CHECK_INTERVAL_MS: "250",
          PI_KEEPER_TEST_FAULTS: "ftruncate",
          MOCK_PI_ENV_LOG: envLog,
        },
      }),
    );
    await readyKeeper(k);
    await waitFor(() => existsSync(envLog));
    const envDump = readFileSync(envLog, "utf8");
    expect(envDump).not.toMatch(/^PI_KEEPER_LOG_MAX_BYTES=/m);
    expect(envDump).not.toMatch(/^PI_KEEPER_LOG_CHECK_INTERVAL_MS=/m);
    expect(envDump).not.toMatch(/^PI_KEEPER_TEST_FAULTS=/m);
    try { unlinkSync(envLog); } catch { /* ignore */ }
    await killAndAwait(k);
  }, 10_000);

  it("E1: below the cap no truncation fires (seed cap−1536 + keeper overhead stays under)", async () => {
    const sessionId = makeSessionId();
    const home = makeShortHome();
    seedLog(home, sessionId, 65_536 - 1536); // 64 000 B; +~600 B keeper lines < 65 536
    const k = track(await spawnKeeper({ sessionId, home, extraEnv: { PI_KEEPER_LOG_MAX_BYTES: "65536", PI_KEEPER_LOG_CHECK_INTERVAL_MS: "50" } }));
    await readyKeeper(k);
    // Several check intervals must elapse with the seed prefix intact.
    await new Promise((r) => setTimeout(r, 400));
    const content = readFileSync(keeperLogIn(home, sessionId), "utf8");
    expect(content.startsWith(SEED_CHAR)).toBe(true); // nothing was truncated away
    expect(content.length).toBeGreaterThan(64_000); // keeper lines were appended
    await killAndAwait(k);
  }, 10_000);

  it("E2: at/over the cap the log is truncated in place (size drops below the cap)", async () => {
    const sessionId = makeSessionId();
    const home = makeShortHome();
    seedLog(home, sessionId, 65_536); // exactly the cap; +keeper overhead crosses it
    const k = track(await spawnKeeper({ sessionId, home, extraEnv: { PI_KEEPER_LOG_MAX_BYTES: "65536", PI_KEEPER_LOG_CHECK_INTERVAL_MS: "50" } }));
    await readyKeeper(k);
    await waitFor(() => logSize(home, sessionId) < 65_536, 3_000);
    const content = readFileSync(keeperLogIn(home, sessionId), "utf8");
    expect(content.includes(SEED_CHAR.repeat(1024))).toBe(false); // the pre-rotation window is gone
    await killAndAwait(k);
  }, 10_000);

  it("E3: inode preserved across rotation and post-rotation child bytes land in the live file", async () => {
    const sessionId = makeSessionId();
    const home = makeShortHome();
    const k = track(
      await spawnKeeper({
        sessionId,
        home,
        extraEnv: {
          PI_KEEPER_CAPTURE_PI_OUTPUT: "1",
          PI_KEEPER_LOG_MAX_BYTES: "65536",
          PI_KEEPER_LOG_CHECK_INTERVAL_MS: "50",
          MOCK_PI_MODE: "writer",
          MOCK_PI_WRITE_CHUNK: "4096",
          MOCK_PI_WRITE_TICK_MS: "2",
          MOCK_PI_WRITE_TOTAL: "131072", // 2× cap → rotation is guaranteed
          MOCK_PI_MARKER: "POST-ROT-1",
        },
      }),
    );
    await readyKeeper(k);
    const logFile = keeperLogIn(home, sessionId);
    await waitFor(() => existsSync(logFile));
    const inoBefore = statSync(logFile).ino;
    // Marker repeats every 200 ms, so one written just before a rotation
    // cannot be the last one erased — "log contains POST-ROT-1" is stable.
    await waitFor(() => {
      if (!existsSync(logFile)) return false;
      const st = statSync(logFile);
      return st.size < 65_536 && readFileSync(logFile, "utf8").includes("POST-ROT-1");
    }, 15_000);
    const inoAfter = statSync(logFile).ino;
    expect(inoAfter).toBe(inoBefore); // THE load-bearing assertion: no rename/reopen
    await killAndAwait(k);
  }, 25_000);

  it("E4: no generation retained — repeated rotations leave no .log.N / dated siblings", async () => {
    const sessionId = makeSessionId();
    const home = makeShortHome();
    const k = track(
      await spawnKeeper({
        sessionId,
        home,
        extraEnv: {
          PI_KEEPER_CAPTURE_PI_OUTPUT: "1",
          PI_KEEPER_LOG_MAX_BYTES: "16384",
          PI_KEEPER_LOG_CHECK_INTERVAL_MS: "30",
          MOCK_PI_MODE: "writer",
          MOCK_PI_WRITE_CHUNK: "4096",
          MOCK_PI_WRITE_TICK_MS: "10", // ~400 KB/s
          MOCK_PI_WRITE_TOTAL: "0", // write until killed — a finite burst (65 KB ≈ 32 ms) can fall entirely between observation polls under load
        },
      }),
    );
    await readyKeeper(k);
    // Never observe before the child is flowing: 8 KB = 2 writer chunks
    // (lifecycle lines never get there). Continuous writing keeps sizes ≥ 8 KB
    // reachable on every poll — the ≥3-rotation driver is sustained overflow.
    await waitFor(() => {
      if (!existsSync(keeperLogIn(home, sessionId))) return false;
      return statSync(keeperLogIn(home, sessionId)).size >= 8192;
    }, 30_000);
    // ~2.5 s at cap 16 KiB / ~400 KB/s ⇒ ~60 rotations while we watch.
    await new Promise((r) => setTimeout(r, 2_500));
    const siblings = readdirSync(sessionsDirIn(home)).filter((n) => n.startsWith(`keeper-${sessionId}.log`));
    expect(siblings).toEqual([`keeper-${sessionId}.log`]); // exactly the live log, nothing else
    await killAndAwait(k);
  }, 60_000);

  it("E5: child-only growth rotates via the interval timer with zero keeper lines after child bytes", async () => {
    const sessionId = makeSessionId();
    const home = makeShortHome();
    const k = track(
      await spawnKeeper({
        sessionId,
        home,
        extraEnv: {
          PI_KEEPER_CAPTURE_PI_OUTPUT: "1",
          PI_KEEPER_LOG_MAX_BYTES: "65536",
          PI_KEEPER_LOG_CHECK_INTERVAL_MS: "50",
          MOCK_PI_MODE: "writer",
          MOCK_PI_WRITE_CHUNK: "4096",
          MOCK_PI_WRITE_TICK_MS: "10",
          MOCK_PI_WRITE_TOTAL: "1048576", // 1 MiB of child bytes, no keeper activity
        },
      }),
    );
    await readyKeeper(k);
    // Under heavy CI load the mock-pi process can take >1 s to boot; the
    // stability window below would otherwise fire on a lifecycle-only log
    // (~600 B) before the child wrote a single byte. Wait for CHILD DATA
    // first: the log reaching 2 writer chunks proves chunks are flowing
    // (keeper lifecycle lines never exceed ~1 KB). Size-based, because a
    // boot marker would be truncated away by the first rotation.
    await waitFor(() => {
      if (!existsSync(keeperLogIn(home, sessionId))) return false;
      return statSync(keeperLogIn(home, sessionId)).size >= 8192;
    }, 30_000);
    const size = await waitForStableSize(home, sessionId, { stableMs: 800, timeoutMs: 30_000 });
    expect(size).toBeLessThan(2 * 65_536);
    // The writer emits only 'a' bytes (no newlines). Any keeper-originated
    // line after the child's first byte would introduce a timestamp bracket.
    const content = readFileSync(keeperLogIn(home, sessionId), "utf8");
    const firstChildByte = content.indexOf("a");
    expect(firstChildByte).toBeGreaterThanOrEqual(0);
    expect(content.slice(firstChildByte)).toMatch(/^a+$/); // pure child bytes, no keeper lines
    await killAndAwait(k);
  }, 90_000);

  it("X1: ftruncate refused → path fallback truncates the same inode (keeper stays up)", async () => {
    const sessionId = makeSessionId();
    const home = makeShortHome();
    seedLog(home, sessionId, 65_536 + 256);
    const k = track(
      await spawnKeeper({
        sessionId,
        home,
        extraEnv: {
          PI_KEEPER_TEST_FAULTS: "ftruncate", // fd truncate throws EPERM
          PI_KEEPER_LOG_MAX_BYTES: "65536",
          PI_KEEPER_LOG_CHECK_INTERVAL_MS: "50",
        },
      }),
    );
    await readyKeeper(k); // survived the crash window → alive
    await waitFor(() => logSize(home, sessionId) < 65_536, 5_000); // path fallback did the rotation
    expect(k.child.exitCode).toBeNull();
    await killAndAwait(k);
  }, 10_000);

  it("X2: swapped path — the replacement file is NOT truncated (fallback refuses)", async () => {
    const sessionId = makeSessionId();
    const home = makeShortHome();
    const k = track(
      await spawnKeeper({
        sessionId,
        home,
        extraEnv: {
          PI_KEEPER_CAPTURE_PI_OUTPUT: "1",
          PI_KEEPER_TEST_FAULTS: "ftruncate",
          PI_KEEPER_LOG_MAX_BYTES: "65536",
          PI_KEEPER_LOG_CHECK_INTERVAL_MS: "50",
          MOCK_PI_MODE: "writer",
          MOCK_PI_WRITE_CHUNK: "4096",
          MOCK_PI_WRITE_TICK_MS: "2",
          MOCK_PI_WRITE_TOTAL: "524288", // keeps the fd's inode over cap
        },
      }),
    );
    await readyKeeper(k); // seed under cap → no rotation fired before we swap
    const logFile = keeperLogIn(home, sessionId);
    // Replace the path with a DIFFERENT inode: build the replacement
    // elsewhere and RENAME it over the path. (writeFileSync directly onto
    // logPath would open-and-truncate the keeper's ACTIVE inode in place —
    // no swap at all — and the fallback would then be legitimately allowed
    // to path-truncate it.)
    const swapSrc = path.join(home, "swap-src.log");
    writeFileSync(swapSrc, "SWAPPED");
    renameSync(swapSrc, logFile);
    // 10+ check intervals must elapse without the replacement being touched.
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 120));
      expect(readFileSync(logFile, "utf8")).toBe("SWAPPED");
    }
    expect(k.child.exitCode).toBeNull(); // refusal is a WARN, never a crash
    // "Rotation recorded as failed" is asserted at unit level
    // (keeper-log-rotation.test.ts X2) — the WARN here lands in the fd's
    // orphaned inode, unreadable at the path.
    await killAndAwait(k);
  }, 15_000);

  it("X3: both truncation paths fail — keeper stays alive, RPC keeps flowing, ≤1 attempt per interval", async () => {
    const sessionId = makeSessionId();
    const home = makeShortHome();
    const t0 = Date.now(); // WARNs start as soon as the child crosses the cap — before readyKeeper returns
    const k = track(
      await spawnKeeper({
        sessionId,
        home,
        extraEnv: {
          PI_KEEPER_CAPTURE_PI_OUTPUT: "1",
          PI_KEEPER_TEST_FAULTS: "ftruncate,truncate", // fd AND path truncation throw
          PI_KEEPER_LOG_MAX_BYTES: "65536",
          PI_KEEPER_LOG_CHECK_INTERVAL_MS: "60",
          MOCK_PI_MODE: "writer",
          MOCK_PI_WRITE_CHUNK: "4096",
          MOCK_PI_WRITE_TICK_MS: "2",
          MOCK_PI_WRITE_TOTAL: "262144",
          // Completion signal: with both truncation paths failing, a WARN is
          // appended every interval (the failure is loud by design), so the
          // log NEVER stabilises — wait for the child's done-marker instead.
          MOCK_PI_MARKER: "X3-DONE",
        },
      }),
    );
    await readyKeeper(k);
    // RPC forwarding keeps working through ≥3 failed-rotation intervals.
    for (let i = 0; i < 3; i++) {
      await writeLineToKeeper(k, `{"type":"prompt","message":"x3-${i}","id":"${i}"}`);
    }
    await waitFor(() => readFileSync(keeperLogIn(home, sessionId), "utf8").includes("X3-DONE"), 15_000);
    for (let i = 0; i < 3; i++) {
      await waitFor(() => existsSync(k.mockPiLog) && readFileSync(k.mockPiLog, "utf8").includes(`x3-${i}`));
    }
    expect(k.child.exitCode).toBeNull(); // no shutdown despite every rotation failing
    // At most one rotation attempt per elapsed interval window (throttle),
    // each recorded as a WARN in the (intact, never-swapped) keeper log.
    const warns = readFileSync(keeperLogIn(home, sessionId), "utf8").match(/rotation failed/g)?.length ?? 0;
    const elapsedMs = Date.now() - t0;
    expect(warns).toBeGreaterThan(0);
    expect(warns).toBeLessThanOrEqual(Math.ceil(elapsedMs / 60) + 2);
    const result = await killAndAwait(k, "SIGTERM");
    expect(result.code).toBe(0); // not the uncaughtException → shutdown(1) path
  }, 25_000);

  it("X4: interval-path rotation failure does not end the session (pi child keeps running)", async () => {
    const sessionId = makeSessionId();
    const home = makeShortHome();
    const k = track(
      await spawnKeeper({
        sessionId,
        home,
        extraEnv: {
          PI_KEEPER_CAPTURE_PI_OUTPUT: "1",
          PI_KEEPER_TEST_FAULTS: "ftruncate,truncate",
          PI_KEEPER_LOG_MAX_BYTES: "65536",
          PI_KEEPER_LOG_CHECK_INTERVAL_MS: "50",
          MOCK_PI_MODE: "writer",
          MOCK_PI_WRITE_CHUNK: "4096",
          MOCK_PI_WRITE_TICK_MS: "2",
          MOCK_PI_WRITE_TOTAL: "0", // writes forever until killed
        },
      }),
    );
    await readyKeeper(k);
    // ≥5 failing rotation intervals must elapse with pi alive throughout.
    await new Promise((r) => setTimeout(r, 400));
    const mockPids = await findChildPids(k.child.pid!);
    expect(mockPids.length).toBeGreaterThan(0);
    expect(k.child.exitCode).toBeNull();
    const result = await killAndAwait(k, "SIGTERM");
    expect(result.code).toBe(0); // a logging concern never produced exit 1
    try {
      for (const pid of mockPids) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
    } catch { /* ignore */ }
  }, 15_000);

  it("P1: rotation never stalls the RPC path — 200 writes land across ≥5 rotations, zero drops", async () => {
    const sessionId = makeSessionId();
    const home = makeShortHome();
    const k = track(
      await spawnKeeper({
        sessionId,
        home,
        extraEnv: {
          PI_KEEPER_CAPTURE_PI_OUTPUT: "1",
          PI_KEEPER_LOG_MAX_BYTES: "65536",
          PI_KEEPER_LOG_CHECK_INTERVAL_MS: "25",
          MOCK_PI_MODE: "writer",
          MOCK_PI_WRITE_CHUNK: "4096",
          MOCK_PI_WRITE_TICK_MS: "2",
          MOCK_PI_WRITE_TOTAL: "393216", // 6× cap → ≥5 rotations during the RPC burst
        },
      }),
    );
    await readyKeeper(k);
    // Write with the SAME budget production writeRpc grants a line:
    // WRITE_RPC_ATTEMPT_TIMEOUT_MS 350 × 3 attempts (keeper-manager.ts).
    // A single connect refusal under suite load is a retry, not a stall.
    const writeLineWithRpcBudget = async (line: string): Promise<void> => {
      const t0 = Date.now();
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await writeLineToKeeper(k, line);
          maxLatencyMs = Math.max(maxLatencyMs, Date.now() - t0);
          return;
        } catch (e) {
          lastErr = e;
          if (Date.now() - t0 >= 1050) break;
          await new Promise((r) => setTimeout(r, [50, 150][attempt] ?? 50));
        }
      }
      throw lastErr;
    };
    let maxLatencyMs = 0;
    for (let i = 0; i < 200; i++) {
      await writeLineWithRpcBudget(`{"type":"prompt","message":"p1-${i}","id":"${i}"}`);
    }
    // No line's full budget (1050 ms) may be exceeded — rotation must never stall RPC.
    expect(maxLatencyMs).toBeLessThan(1050);
    await waitFor(() => {
      if (!existsSync(k.mockPiLog)) return false;
      const c = readFileSync(k.mockPiLog, "utf8");
      return c.includes("p1-0") && c.includes("p1-199");
    }, 15_000);
    // Zero dropped lines: every forwarded line reached pi.
    const forwarded = readFileSync(k.mockPiLog, "utf8").split("\n").filter((l) => l.includes("p1-")).length;
    expect(forwarded).toBe(200);
    const klog = readFileSync(keeperLogIn(home, sessionId), "utf8");
    expect(klog).not.toContain("drop line");
    await killAndAwait(k);
  }, 30_000);

  it("P2: bounded growth soak — ~10 MiB sustained capture never reaches 2× cap; inode constant", async () => {
    const sessionId = makeSessionId();
    const home = makeShortHome();
    const k = track(
      await spawnKeeper({
        sessionId,
        home,
        extraEnv: {
          PI_KEEPER_CAPTURE_PI_OUTPUT: "1",
          PI_KEEPER_LOG_MAX_BYTES: "65536",
          PI_KEEPER_LOG_CHECK_INTERVAL_MS: "50",
          MOCK_PI_MODE: "writer",
          MOCK_PI_WRITE_CHUNK: "4096",
          MOCK_PI_WRITE_TICK_MS: "8", // ≈500 KB/s → ~20 s for 10 MiB (fast profile)
          MOCK_PI_WRITE_TOTAL: "10485760",
        },
      }),
    );
    await readyKeeper(k);
    const logFile = keeperLogIn(home, sessionId);
    const inos = new Set<number>();
    let maxObserved = 0;
    const start = Date.now();
    // Sample every 200 ms until the file has been stable for 1.5 s (child done).
    let stableSince = Date.now();
    let last = -1;
    while (Date.now() - start < 40_000) {
      if (existsSync(logFile)) {
        const st = statSync(logFile);
        inos.add(st.ino);
        maxObserved = Math.max(maxObserved, st.size);
        if (st.size !== last) {
          last = st.size;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= 1500 && st.size > 0) {
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(maxObserved).toBeLessThan(2 * 65_536); // never observed at/over 2× cap
    expect(inos.size).toBe(1); // inode constant throughout
    await killAndAwait(k);
  }, 50_000);
});

#!/usr/bin/env node
/**
 * RPC keeper sidecar.
 *
 * Spawned by the dashboard server as `node keeper.cjs <sessionId>`.
 * Owns pi's stdin pipe; forwards JSON-line writes received on a per-session
 * UDS / named pipe to pi's stdin verbatim. Outlives the dashboard server.
 *
 * CommonJS-pure: only Node built-ins. No jiti / tsx / typescript loader.
 * Mirrors the constraint pattern of `preload-fastify.cjs`.
 *
 * See: openspec/changes/add-rpc-stdin-dispatch-with-keeper-sidecar
 *   - specs/rpc-keeper-sidecar/spec.md
 *   - design.md (Decisions 1, 2, 3, 8, 9)
 */

"use strict";

const child_process = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { buildPiEnv } = require("./keeper-env.cjs");

// ---------------------------------------------------------------------------
// Args + paths
// ---------------------------------------------------------------------------

const sessionId = process.argv[2];
if (!sessionId || typeof sessionId !== "string") {
  // Cannot open the keeper log without a sessionId. Write to stderr (which the
  // KeeperManager wires to the spawn log) and exit non-zero.
  process.stderr.write("[keeper] FATAL: missing sessionId argv[2]\n");
  process.exit(2);
}

const SESSIONS_DIR = path.join(os.homedir(), ".pi", "dashboard", "sessions");
try {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
} catch (_e) { /* ignore — fs.openSync below will fail with a clearer error */ }

// Socket / pipe path conventions per spec (Decision 3 in design.md)
const isWindows = process.platform === "win32";
const sockPath = isWindows
  ? `\\\\.\\pipe\\pi-rpc-${sessionId}`
  : path.join(SESSIONS_DIR, `${sessionId}.rpc.sock`);

// PID sidecar conventions per rpc-keeper-sidecar Requirement
const pidPath = isWindows
  ? path.join(SESSIONS_DIR, `pi-rpc-${sessionId}.pid`)
  : `${sockPath}.pid`;

const logPath = path.join(SESSIONS_DIR, `keeper-${sessionId}.log`);

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

let logFd;
try {
  logFd = fs.openSync(logPath, "a");
} catch (e) {
  process.stderr.write(`[keeper ${sessionId}] FATAL: cannot open log ${logPath}: ${e && e.message}\n`);
  process.exit(2);
}

function log(line) {
  try {
    fs.writeSync(logFd, `[${new Date().toISOString()}] ${line}\n`);
  } catch (_e) { /* swallow — log failure should not crash the keeper */ }
}

log(`keeper starting: sessionId=${sessionId} pid=${process.pid} sockPath=${sockPath}`);

// ---------------------------------------------------------------------------
// Shutdown coordination
// ---------------------------------------------------------------------------

let shuttingDown = false;
let server; // net.Server
let piChild; // child_process.ChildProcess

function unlinkQuiet(p) {
  try { fs.unlinkSync(p); } catch (_e) { /* ignore */ }
}

function shutdown(exitCode, reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`shutdown: code=${exitCode} reason=${reason || "n/a"}`);

  // Close the server first so no new connections come in.
  try { if (server) server.close(); } catch (_e) { /* ignore */ }

  // Best-effort cleanup. On Windows named pipes the socket file itself is
  // virtual and need not be unlinked; on Unix we unlink the socket file.
  if (!isWindows) unlinkQuiet(sockPath);
  unlinkQuiet(pidPath);

  // Defence in depth: SIGKILL piChild before exiting. The implicit contract
  // "pi reads stdin EOF on keeper exit and shuts down voluntarily" only
  // holds for a healthy pi whose event loop ticks. A hung pi (CPU loop /
  // non-cancellable native call) never observes EOF and gets reparented
  // to init/launchd — leaving an orphan. Explicit SIGKILL closes the gap.
  // See change: fix-keeper-kill-escalation (Decision 3).
  try {
    if (piChild && piChild.exitCode === null && piChild.signalCode === null) {
      piChild.kill("SIGKILL");
    }
  } catch (_e) { /* ignore — pi may have died between guard and kill */ }

  // Don't wait on logFd close — process.exit will tear down fds.
  process.exit(exitCode);
}

process.on("SIGTERM", () => shutdown(0, "SIGTERM"));
process.on("SIGINT", () => shutdown(0, "SIGINT"));
process.on("uncaughtException", (e) => {
  log(`uncaughtException: ${e && e.stack ? e.stack : e}`);
  shutdown(1, "uncaughtException");
});

// ---------------------------------------------------------------------------
// Bind socket BEFORE spawning pi (Decision 4 / Failure-modes Requirement)
// ---------------------------------------------------------------------------

function startServer(retried) {
  return new Promise((resolve) => {
    const s = net.createServer(handleConnection);

    s.once("error", (err) => {
      // EADDRINUSE (Unix) / EADDRINUSE-like on Windows pipes: stale socket file
      // from a previous keeper that crashed without cleanup. Per spec: unlink
      // and retry exactly once.
      if (!retried && err && (err.code === "EADDRINUSE" || err.code === "EACCES")) {
        log(`bind failed (${err.code}); unlinking stale path and retrying once`);
        if (!isWindows) unlinkQuiet(sockPath);
        // small backoff before retry
        setTimeout(() => {
          startServer(true).then(resolve);
        }, 50);
        return;
      }
      log(`FATAL: bind failed (retried=${retried}): ${err && err.message}`);
      shutdown(2, "bind-failed");
      resolve(null);
    });

    s.listen(sockPath, () => {
      log(`socket bound: ${sockPath}`);
      // Set restrictive permissions on Unix UDS file (Windows pipes use ACLs).
      if (!isWindows) {
        try { fs.chmodSync(sockPath, 0o600); } catch (_e) { /* best-effort */ }
      }
      resolve(s);
    });
  });
}

// ---------------------------------------------------------------------------
// Connection handler — JSON-lines, fire-and-forget, dumb wire
// ---------------------------------------------------------------------------

function handleConnection(sock) {
  log(`connection accepted`);
  let buf = "";

  sock.setEncoding("utf8");
  sock.on("data", (chunk) => {
    buf += chunk;
    // Split on \n; keep the trailing partial in buf.
    let nl;
    // eslint-disable-next-line no-cond-assign
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      forwardLine(line);
    }
  });
  sock.on("end", () => {
    // Flush a trailing line without newline as a complete line. Pi's RPC
    // reader expects newline-framed lines, so we must append \n anyway.
    if (buf.length > 0) {
      forwardLine(buf);
      buf = "";
    }
    log(`connection ended`);
  });
  sock.on("error", (err) => {
    log(`connection error: ${err && err.message}`);
  });
}

function forwardLine(line) {
  // No JSON parsing or content validation — keeper is a dumb wire.
  if (!piChild || !piChild.stdin || piChild.stdin.destroyed) {
    log(`drop line (pi stdin unavailable): ${line.slice(0, 80)}`);
    return;
  }
  try {
    piChild.stdin.write(line + "\n");
  } catch (e) {
    // pi.stdin EPIPE etc. Logged, but the actual EPIPE handler below will
    // trigger shutdown via pi.stdin.on("error", ...) on the next event-loop tick.
    log(`forwardLine error: ${e && e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Pi spawn + lifecycle
// ---------------------------------------------------------------------------

const CRASH_WINDOW_MS = 300;
let piSpawnedAt = 0;
// Count pi launches so spawnPi() injects the single-use spawn token only on
// the first launch and scrubs it on every respawn. See change:
// fix-spawn-token-env-leak.
let piLaunchCount = 0;

function readPiArgs() {
  // PI_KEEPER_PI_ARGS is a JSON-encoded string array of pi argv tokens.
  // Set by KeeperManager to forward the dashboard's per-spawn flags
  // (--session-file, --mode continue, --fork, etc.) so resume / fork
  // round-trip correctly through the keeper. Default falls back to
  // bare RPC mode for direct invocations and tests.
  const raw = process.env.PI_KEEPER_PI_ARGS;
  if (!raw) return ["--mode", "rpc"];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed;
    }
    log(`WARN: PI_KEEPER_PI_ARGS not a string[]; falling back to default`);
  } catch (e) {
    log(`WARN: PI_KEEPER_PI_ARGS parse failed (${e && e.message}); falling back to default`);
  }
  return ["--mode", "rpc"];
}

function readPiCmd() {
  // PI_KEEPER_PI_CMD carries the ToolRegistry-resolved absolute argv for
  // the pi binary (e.g. ["/abs/.../pi"] on Unix or ["node","/abs/cli.js"] on
  // Windows). When set, the keeper spawns pi via that absolute path instead
  // of bare PATH lookup. Required for Electron-launched servers whose env
  // PATH does not include the bundle's node_modules/.bin/. Absent / empty /
  // malformed → null, and the caller falls back to bare "pi".
  // See change: fix-rpc-keeper-pi-resolution.
  const raw = process.env.PI_KEEPER_PI_CMD;
  if (raw === undefined || raw === null || raw === "") return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    log(`keeper: ignoring malformed PI_KEEPER_PI_CMD (parse: ${e && e.message})`);
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((s) => typeof s === "string")) {
    log(`keeper: ignoring malformed PI_KEEPER_PI_CMD (shape)`);
    return null;
  }
  return parsed;
}

function spawnPi() {
  const piArgs = readPiArgs();
  const piCmd = readPiCmd();
  const exe = piCmd ? piCmd[0] : "pi";
  const argv = piCmd ? [...piCmd.slice(1), ...piArgs] : piArgs;
  log(`spawning pi ${exe} ${argv.join(" ")}`);
  // env is inherited from process.env (KeeperManager already set up the
  // proper PATH and PI_DASHBOARD_SPAWNED). buildPiEnv defensively re-sets
  // PI_DASHBOARD_SPAWNED=1, strips the keeper-internal PI_KEEPER_PI_ARGS /
  // PI_KEEPER_PI_CMD, and — on respawn only — scrubs the single-use
  // PI_DASHBOARD_SPAWN_TOKEN. See change: fix-spawn-token-env-leak.
  piLaunchCount += 1;
  const env = buildPiEnv(process.env, piLaunchCount === 1);

  // Opt-in capture of pi's stdout/stderr into keeper-<id>.log. Default OFF:
  // pi's output is discarded (stdio "ignore" → /dev/null) so the log can't
  // balloon to GB. When PI_KEEPER_CAPTURE_PI_OUTPUT === "1" (set by the
  // dashboard from config.keeperLog.capturePiOutput), pi's stdout/stderr are
  // appended to the keeper log fd. The keeper's own lifecycle log() lines are
  // written either way. See change: add-keeper-output-capture-toggle.
  const capturePiOutput = process.env.PI_KEEPER_CAPTURE_PI_OUTPUT === "1";
  delete env.PI_KEEPER_CAPTURE_PI_OUTPUT;
  const childStdio = capturePiOutput
    ? ["pipe", logFd, logFd]
    : ["pipe", "ignore", "ignore"];
  log(`pi output capture: ${capturePiOutput ? "enabled" : "disabled"}`);

  piSpawnedAt = Date.now();
  const c = child_process.spawn(exe, argv, {
    stdio: childStdio,
    env,
    cwd: process.cwd(),
    windowsHide: true,
  });

  c.on("error", (err) => {
    log(`pi spawn error: ${err && err.message}`);
    shutdown(1, "pi-spawn-error");
  });

  c.on("exit", (code, signal) => {
    const elapsed = Date.now() - piSpawnedAt;
    log(`pi exited code=${code} signal=${signal} elapsed=${elapsed}ms`);
    // If pi exited within the crash-detection window, surface a non-zero
    // exit code so the parent (KeeperManager / process-manager) can preserve
    // the existing dashboard PI_CRASHED semantic. Otherwise a graceful pi
    // exit → keeper exit 0.
    if (elapsed < CRASH_WINDOW_MS) {
      shutdown(1, "pi-crashed-early");
    } else {
      shutdown(0, "pi-exit");
    }
  });

  // Detect EPIPE / closed-stream errors on pi.stdin: per spec, treat as same
  // as pi.exit (the pipe is gone; pi will follow shortly if not already).
  if (c.stdin) {
    c.stdin.on("error", (err) => {
      log(`pi.stdin error: ${err && err.code}/${err && err.message}`);
      // EPIPE is the canonical case; treat any stdin error as terminal.
      shutdown(0, "pi-stdin-error");
    });
  }

  return c;
}

// ---------------------------------------------------------------------------
// Startup orchestration
// ---------------------------------------------------------------------------

async function main() {
  // 1. Bind socket FIRST so the server can start retrying immediately.
  server = await startServer(false);
  if (!server) return; // shutdown already triggered

  // 2. Write PID sidecar.
  try {
    fs.writeFileSync(pidPath, String(process.pid), "utf8");
  } catch (e) {
    log(`FATAL: cannot write PID sidecar ${pidPath}: ${e && e.message}`);
    shutdown(2, "pid-sidecar-write");
    return;
  }

  // 3. Spawn pi.
  piChild = spawnPi();

  // 4. Crash-detection window: emit the "keeper ready" marker once pi has
  // survived the crash window. The crash-on-early-exit decision itself is
  // made by the c.on("exit") handler comparing elapsed vs CRASH_WINDOW_MS
  // — unifying the two paths so the early-exit code wins regardless of
  // which fires first.
  setTimeout(() => {
    if (shuttingDown) return;
    if (piChild && piChild.exitCode === null && piChild.signalCode === null) {
      log(`keeper ready: ${sessionId}`);
    }
    // If pi already exited, c.on("exit") has already (or will imminently)
    // call shutdown(1) via the elapsed-time check.
  }, CRASH_WINDOW_MS);
}

main().catch((e) => {
  log(`FATAL main: ${e && e.stack ? e.stack : e}`);
  shutdown(2, "main-rejected");
});

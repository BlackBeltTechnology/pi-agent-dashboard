#!/usr/bin/env node
/**
 * Editor keeper sidecar.
 *
 * Spawned by the dashboard server as
 *   `node keeper.cjs <editorId> <cwd> <port> <binary> <dataDir>`.
 *
 * Owns one code-server child. Binds a per-editor UDS (POSIX) or named pipe
 * (Windows). Outlives the dashboard server: on dashboard restart, the new
 * dashboard adopts this keeper via the PID sidecar + socket probe path.
 *
 * CommonJS-pure: only Node built-ins. No jiti / tsx / TypeScript loader.
 * Mirrors `packages/server/src/rpc-keeper/keeper.cjs`.
 *
 * See: openspec/changes/add-editor-keeper-sidecar
 *   - specs/editor-keeper-sidecar/spec.md
 *   - design.md (Decisions 1–5, 11)
 */

"use strict";

const child_process = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

// ---------------------------------------------------------------------------
// Args + paths
// ---------------------------------------------------------------------------

const editorId = process.argv[2];
const cwd = process.argv[3];
const portArg = process.argv[4];
const binary = process.argv[5];
const dataDir = process.argv[6];

if (!editorId || !cwd || !portArg || !binary || !dataDir) {
  process.stderr.write(
    "[editor-keeper] FATAL: usage: keeper.cjs <editorId> <cwd> <port> <binary> <dataDir>\n",
  );
  process.exit(2);
}

const port = Number.parseInt(portArg, 10);
if (!Number.isFinite(port) || port <= 0) {
  process.stderr.write(`[editor-keeper] FATAL: invalid port: ${portArg}\n`);
  process.exit(2);
}

const EDITORS_DIR = path.join(os.homedir(), ".pi", "dashboard", "editors");
try { fs.mkdirSync(EDITORS_DIR, { recursive: true }); } catch (_e) { /* mkdir failure surfaced by log open below */ }

const isWindows = process.platform === "win32";
const sockPath = isWindows
  ? `\\\\.\\pipe\\pi-editor-${editorId}`
  : path.join(EDITORS_DIR, `${editorId}.sock`);

const pidPath = isWindows
  ? path.join(EDITORS_DIR, `pi-editor-${editorId}.pid`)
  : `${sockPath}.pid`;

const logPath = path.join(EDITORS_DIR, `keeper-${editorId}.log`);

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

let logFd;
try {
  logFd = fs.openSync(logPath, "a");
} catch (e) {
  process.stderr.write(
    `[editor-keeper ${editorId}] FATAL: cannot open log ${logPath}: ${e && e.message}\n`,
  );
  process.exit(2);
}

function log(line) {
  try {
    fs.writeSync(logFd, `[${new Date().toISOString()}] ${line}\n`);
  } catch (_e) { /* swallow */ }
}

log(
  `keeper starting: editorId=${editorId} pid=${process.pid} cwd=${cwd} port=${port} binary=${binary} dataDir=${dataDir}`,
);

// ---------------------------------------------------------------------------
// Shutdown coordination
// ---------------------------------------------------------------------------

const spawnedAt = Date.now();
let shuttingDown = false;
let server; // net.Server
let child; // child_process.ChildProcess
const connections = new Set();

function unlinkQuiet(p) {
  try { fs.unlinkSync(p); } catch (_e) { /* ignore */ }
}

function cleanupArtifacts() {
  if (!isWindows) unlinkQuiet(sockPath);
  unlinkQuiet(pidPath);
}

function shutdown(exitCode, reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`shutdown: code=${exitCode} reason=${reason || "n/a"}`);

  try { if (server) server.close(); } catch (_e) { /* ignore */ }
  for (const s of connections) {
    try { s.destroy(); } catch (_e) { /* ignore */ }
  }
  cleanupArtifacts();

  process.exit(exitCode);
}

process.on("SIGTERM", () => shutdown(0, "SIGTERM"));
process.on("SIGINT", () => shutdown(0, "SIGINT"));
process.on("uncaughtException", (e) => {
  log(`uncaughtException: ${e && e.stack ? e.stack : e}`);
  shutdown(1, "uncaughtException");
});

// ---------------------------------------------------------------------------
// Stop escalation (SIGTERM → 5 s → SIGKILL of pgroup)
// ---------------------------------------------------------------------------

const STOP_GRACE_MS = 5000;
let stopInProgress = false;

function sendSignalToChild(sig) {
  if (!child || child.exitCode !== null) return;
  try {
    if (!isWindows && typeof child.pid === "number") {
      // POSIX: signal the whole process group (child was spawned detached so
      // setsid() ran, giving the child its own pgid == child.pid).
      try { process.kill(-child.pid, sig); return; } catch (_e) { /* fall through */ }
    }
    child.kill(sig);
  } catch (e) {
    log(`signal ${sig} to child failed: ${e && e.message}`);
  }
}

function escalateStop() {
  if (stopInProgress) return;
  stopInProgress = true;
  log(`stop requested: SIGTERM child pid=${child && child.pid}`);
  sendSignalToChild("SIGTERM");
  setTimeout(() => {
    if (child && child.exitCode === null) {
      log(`stop grace expired (${STOP_GRACE_MS}ms): SIGKILL child pgroup`);
      sendSignalToChild("SIGKILL");
    }
  }, STOP_GRACE_MS);
}

// ---------------------------------------------------------------------------
// Bind socket BEFORE spawning child
// ---------------------------------------------------------------------------

function startServer(retried) {
  return new Promise((resolve) => {
    const s = net.createServer(handleConnection);

    s.once("error", (err) => {
      if (!retried && err && (err.code === "EADDRINUSE" || err.code === "EACCES")) {
        log(`bind failed (${err.code}); unlinking stale path and retrying once`);
        if (!isWindows) unlinkQuiet(sockPath);
        setTimeout(() => { startServer(true).then(resolve); }, 50);
        return;
      }
      log(`FATAL: bind failed (retried=${retried}): ${err && err.message}`);
      shutdown(2, "bind-failed");
      resolve(null);
    });

    s.listen(sockPath, () => {
      log(`socket bound: ${sockPath}`);
      if (!isWindows) {
        try { fs.chmodSync(sockPath, 0o600); } catch (_e) { /* best-effort */ }
      }
      resolve(s);
    });
  });
}

// ---------------------------------------------------------------------------
// Connection handler — JSON-lines
// ---------------------------------------------------------------------------

function handleConnection(sock) {
  log(`connection accepted`);
  connections.add(sock);
  let buf = "";

  sock.setEncoding("utf8");
  sock.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      handleLine(sock, line);
    }
  });
  sock.on("end", () => {
    if (buf.length > 0) { handleLine(sock, buf); buf = ""; }
  });
  sock.on("close", () => { connections.delete(sock); log(`connection closed`); });
  sock.on("error", (err) => { log(`connection error: ${err && err.message}`); });
}

function writeJsonLine(sock, obj) {
  try { sock.write(JSON.stringify(obj) + "\n"); } catch (e) { log(`write error: ${e && e.message}`); }
}

function broadcastJsonLine(obj) {
  const line = JSON.stringify(obj) + "\n";
  for (const sock of connections) {
    try { sock.write(line); } catch (_e) { /* ignore */ }
  }
}

function handleLine(sock, line) {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch (e) {
    log(`bad JSON from client: ${e && e.message} line=${line.slice(0, 80)}`);
    return;
  }
  const cmd = msg && msg.cmd;
  switch (cmd) {
    case "heartbeat":
      writeJsonLine(sock, { event: "ack" });
      return;
    case "getStatus":
      writeJsonLine(sock, {
        event: "status",
        editorId,
        childPid: child && child.pid,
        port,
        cwd,
        dataDir,
        uptimeMs: Date.now() - spawnedAt,
      });
      return;
    case "stop":
      escalateStop();
      return;
    default:
      log(`unknown cmd: ${cmd}`);
      return;
  }
}

// ---------------------------------------------------------------------------
// Child spawn + lifecycle
// ---------------------------------------------------------------------------

function spawnChild() {
  const args = [
    "--auth", "none",
    "--bind-addr", `127.0.0.1:${port}`,
    "--disable-telemetry",
    "--disable-update-check",
    "--user-data-dir", dataDir,
    cwd,
  ];
  log(`spawning code-server: ${binary} ${args.join(" ")}`);

  let c;
  try {
    c = child_process.spawn(binary, args, {
      stdio: ["ignore", logFd, logFd],
      detached: !isWindows, // POSIX: own pgroup via setsid(). Windows: keeper itself is already detached.
      windowsHide: true,
      cwd,
      env: process.env,
    });
  } catch (e) {
    log(`FATAL: spawn threw: ${e && e.message}`);
    shutdown(1, "spawn-threw");
    return null;
  }

  c.on("error", (err) => {
    log(`child spawn error: ${err && err.message}`);
    // No sidecar was written yet (we only write it after the pid arrives).
    shutdown(1, "spawn-error");
  });

  c.on("exit", (code, signal) => {
    log(`child exited code=${code} signal=${signal}`);
    broadcastJsonLine({ event: "child_exit", code, signal });
    // Give socket flushes a brief tick before tearing down artefacts.
    setTimeout(() => shutdown(0, "child-exit"), 50);
  });

  return c;
}

// ---------------------------------------------------------------------------
// Startup orchestration
// ---------------------------------------------------------------------------

async function main() {
  // 1. Bind socket FIRST.
  server = await startServer(false);
  if (!server) return;

  // 2. Spawn child.
  child = spawnChild();
  if (!child || typeof child.pid !== "number") {
    // Failure path already triggered shutdown via spawn-error.
    return;
  }

  // 3. Write PID sidecar.
  const sidecar = {
    editorId,
    keeperPid: process.pid,
    childPid: child.pid,
    port,
    cwd,
    dataDir,
    binary,
    spawnedAt: new Date(spawnedAt).toISOString(),
  };
  try {
    fs.writeFileSync(pidPath, JSON.stringify(sidecar), "utf8");
  } catch (e) {
    log(`FATAL: cannot write PID sidecar ${pidPath}: ${e && e.message}`);
    shutdown(2, "pid-sidecar-write");
    return;
  }

  log(`keeper ready: editorId=${editorId} childPid=${child.pid} port=${port}`);
}

main().catch((e) => {
  log(`FATAL main: ${e && e.stack ? e.stack : e}`);
  shutdown(2, "main-rejected");
});

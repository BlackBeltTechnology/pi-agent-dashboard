#!/usr/bin/env node
/**
 * Fixture Dashboard Launcher for iOS Visual Tests.
 *
 * Starts an isolated dashboard instance with deterministic fixture state,
 * connects a test-pi bridge to replay production-shaped events, and
 * optionally runs visual tests against it.
 *
 * Usage:
 *   node scripts/fixture-launcher.mjs              # Start fixture, validate, run WDIO
 *   node scripts/fixture-launcher.mjs --validate   # Validate fixture only (no simulator)
 *   node scripts/fixture-launcher.mjs --serve      # Start fixture and keep running
 */

import { spawn, execSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUITE_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolve(SUITE_DIR, "..", "..");
const FIXTURE_DIR = join(SUITE_DIR, ".tmp", "fixture");
const FIXTURE_HOME = join(FIXTURE_DIR, "home");
const FIXTURE_CONFIG_DIR = join(FIXTURE_HOME, ".pi", "dashboard");
const FIXTURE_SESSIONS_DIR = join(FIXTURE_HOME, ".pi", "agent", "sessions");
const FIXTURE_CWDS_DIR = join(FIXTURE_DIR, "cwd");

const PORT = parseInt(process.env.PI_DASHBOARD_FIXTURE_PORT || "9800", 10);
const PI_PORT = parseInt(process.env.PI_DASHBOARD_FIXTURE_PI_PORT || "9998", 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const ARGS = process.argv.slice(2);
const VALIDATE_ONLY = ARGS.includes("--validate");
const SERVE_ONLY = ARGS.includes("--serve");

// ── Logging ──────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[fixture] ${msg}`);
}

function warn(msg) {
  console.warn(`[fixture:WARN] ${msg}`);
}

function die(msg) {
  console.error(`[fixture:FATAL] ${msg}`);
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function httpGet(url) {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return { status: resp.status, body: await resp.text() };
  } catch {
    return { status: 0, body: "" };
  }
}

async function waitForHealth(port, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { status } = await httpGet(`http://127.0.0.1:${port}/api/health`);
    if (status === 200) {
      log(`${label} healthy on port ${port}`);
      return;
    }
    await sleep(500);
  }
  die(`${label} did not become healthy within ${timeoutMs}ms`);
}

async function waitForSpa(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { status, body } = await httpGet(`http://127.0.0.1:${port}/`);
    if (status === 200 && (body.includes("<!doctype") || body.includes("<html"))) {
      log("SPA is serving dashboard HTML");
      return;
    }
    await sleep(500);
  }
  die(`SPA not serving dashboard HTML at http://127.0.0.1:${port}/ within ${timeoutMs}ms`);
}

function isPortFree(port) {
  try {
    const out = execSync(`lsof -ti:${port} 2>/dev/null || echo ""`, {
      encoding: "utf-8",
      timeout: 3000,
    });
    return out.trim() === "";
  } catch {
    return true;
  }
}

// ── Fixture State ────────────────────────────────────────────────────

const FIXTURE_NOW = 1714771200000;

const SESSIONS = [
  {
    sessionId: "fixture-session-active",
    cwd: "__fixture__/projects/my-app",
    name: "Add user authentication",
    source: "pi",
    model: "claude-sonnet-4-20250514",
    thinkingLevel: "high",
    startedAt: FIXTURE_NOW - 600_000,
    endedAt: null,
    status: "active",
    eventCount: 6,
    pid: 90001,
    firstMessage: "Add user authentication to the login flow",
    gitBranch: "feature/user-auth",
    gitBranchUrl: "https://github.com/fixture/my-app/tree/feature/user-auth",
  },
  {
    sessionId: "fixture-session-ended",
    cwd: "__fixture__/projects/legacy-app",
    name: "Fix navigation bug",
    source: "pi",
    model: "claude-sonnet-4-20250514",
    thinkingLevel: "medium",
    startedAt: FIXTURE_NOW - 3_600_000,
    endedAt: FIXTURE_NOW - 1_800_000,
    status: "ended",
    eventCount: 4,
    pid: 90002,
    firstMessage: "Fix the navigation bug when switching between tabs",
    gitBranch: "fix/nav-bug",
    gitBranchUrl: "https://github.com/fixture/legacy-app/tree/fix/nav-bug",
  },
];

const EVENTS = {
  "fixture-session-active": [
    { eventType: "message_start", timestamp: FIXTURE_NOW - 590_000, data: { role: "user", content: "Add user authentication to the login flow", nonce: "fixture-msg-1" } },
    { eventType: "message_end", timestamp: FIXTURE_NOW - 580_000, data: { role: "assistant", content: "I'll add user authentication to the login flow. Let me start by examining the current login component and then add JWT-based auth.", nonce: "fixture-msg-2" } },
    { eventType: "tool_start", timestamp: FIXTURE_NOW - 570_000, data: { toolName: "read", toolCallId: "fixture-tool-1", input: { path: "src/components/Login.tsx" } } },
    { eventType: "tool_end", timestamp: FIXTURE_NOW - 560_000, data: { toolName: "read", toolCallId: "fixture-tool-1", output: "export default function Login() {\n  return <form>...</form>;\n}" } },
    { eventType: "message_start", timestamp: FIXTURE_NOW - 550_000, data: { role: "assistant", content: "I've reviewed the login component. The auth flow will use JWT tokens stored in localStorage with refresh token rotation.", nonce: "fixture-msg-3" } },
    { eventType: "message_end", timestamp: FIXTURE_NOW - 540_000, data: { role: "assistant", content: "The implementation is complete. Here's what was added:\n\n- JWT token generation and validation\n- Refresh token rotation\n- Protected route middleware", nonce: "fixture-msg-4" } },
  ],
  "fixture-session-ended": [
    { eventType: "message_start", timestamp: FIXTURE_NOW - 3_590_000, data: { role: "user", content: "Fix the navigation bug when switching between tabs", nonce: "fixture-ended-msg-1" } },
    { eventType: "message_end", timestamp: FIXTURE_NOW - 3_580_000, data: { role: "assistant", content: "The navigation bug was caused by stale state in the tab switcher. The fix ensures the active tab index resets on route change.", nonce: "fixture-ended-msg-2" } },
    { eventType: "tool_start", timestamp: FIXTURE_NOW - 3_570_000, data: { toolName: "edit", toolCallId: "fixture-ended-tool-1", input: { path: "src/components/NavTabs.tsx" } } },
    { eventType: "tool_end", timestamp: FIXTURE_NOW - 3_560_000, data: { toolName: "edit", toolCallId: "fixture-ended-tool-1", output: "Applied fix — reset tab index on route change." } },
  ],
};

// ── Setup ────────────────────────────────────────────────────────────

function setupDirectories() {
  log("Setting up fixture directories...");

  if (existsSync(FIXTURE_DIR)) {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }

  mkdirSync(FIXTURE_CONFIG_DIR, { recursive: true });
  mkdirSync(FIXTURE_SESSIONS_DIR, { recursive: true });
  mkdirSync(FIXTURE_CWDS_DIR, { recursive: true });

  for (const cwdRel of ["projects/my-app", "projects/legacy-app"]) {
    const cwdDir = join(FIXTURE_CWDS_DIR, cwdRel);
    mkdirSync(cwdDir, { recursive: true });
    writeFileSync(join(cwdDir, ".gitkeep"), "");
  }

  writeFileSync(
    join(FIXTURE_CONFIG_DIR, "config.json"),
    JSON.stringify(
      {
        port: PORT,
        piPort: PI_PORT,
        dev: false,
        autoShutdown: false,
        tunnel: { enabled: false },
        auth: null,
        memoryLimits: {
          maxEventsPerSession: 100,
          maxStringFieldSize: 50000,
          maxWsBufferBytes: 1048576,
        },
        editor: { enabled: false },
        openspec: { enabled: false },
        reattachPlacement: "most-recent",
        cors: { allowedOrigins: [] },
        push: { enabled: false },
      },
      null,
      2
    )
  );

  for (const s of SESSIONS) {
    const meta = {
      id: s.sessionId,
      name: s.name,
      cwd: join(FIXTURE_CWDS_DIR, s.cwd),
      source: s.source,
      model: s.model,
      thinkingLevel: s.thinkingLevel,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      status: s.status,
      firstMessage: s.firstMessage,
      gitBranch: s.gitBranch,
      gitBranchUrl: s.gitBranchUrl,
    };
    writeFileSync(
      join(FIXTURE_SESSIONS_DIR, `${s.sessionId}.meta.json`),
      JSON.stringify(meta, null, 2)
    );
    writeFileSync(
      join(FIXTURE_SESSIONS_DIR, `${s.sessionId}.jsonl`),
      ""
    );
  }

  // Path-safety: verify all resolved paths are under FIXTURE_DIR
  for (const s of SESSIONS) {
    const metaPath = join(FIXTURE_SESSIONS_DIR, `${s.sessionId}.meta.json`);
    const cwdPath = join(FIXTURE_CWDS_DIR, s.cwd);
    if (!metaPath.startsWith(FIXTURE_DIR)) {
      die(`Path-safety violation: meta path ${metaPath} is outside fixture dir`);
    }
    if (!cwdPath.startsWith(FIXTURE_DIR)) {
      die(`Path-safety violation: cwd path ${cwdPath} is outside fixture dir`);
    }
  }

  log("Fixture directories and config created.");
}

// ── Port check ───────────────────────────────────────────────────────

function checkPorts() {
  if (!isPortFree(PORT)) {
    die(`Port ${PORT} is in use. Free it or set PI_DASHBOARD_FIXTURE_PORT.`);
  }
  if (!isPortFree(PI_PORT)) {
    die(`Port ${PI_PORT} is in use. Free it or set PI_DASHBOARD_FIXTURE_PI_PORT.`);
  }
  log(`Ports ${PORT} (HTTP) and ${PI_PORT} (pi-gateway) are free.`);
}

// ── Dashboard Server ─────────────────────────────────────────────────

function buildClientIfNeeded() {
  const clientDist = join(REPO_ROOT, "packages", "client", "dist");
  if (existsSync(join(clientDist, "index.html"))) {
    log("Client build found — using production static files.");
    return;
  }
  log("Client build not found — building...");
  execSync("npm run build", { cwd: REPO_ROOT, stdio: "inherit", timeout: 120000 });
  log("Client build complete.");
}

let serverProc = null;

function startServer() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      HOME: FIXTURE_HOME,
      PI_DASHBOARD_PORT: String(PORT),
      PI_DASHBOARD_PI_PORT: String(PI_PORT),
      PI_DASHBOARD_FIXTURE_MODE: "1",
    };

    log(`Starting dashboard server on port ${PORT}...`);
    serverProc = spawn(
      "node",
      ["--import", "tsx", "packages/server/src/cli.ts"],
      {
        cwd: REPO_ROOT,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      }
    );

    let started = false;
    const onData = (chunk) => {
      const text = chunk.toString();
      if (!started && (text.includes("listening on") || text.includes("Server running"))) {
        started = true;
        resolve();
      }
    };

    serverProc.stdout?.on("data", onData);
    serverProc.stderr?.on("data", onData);

    serverProc.on("error", (err) => {
      if (!started) reject(err);
    });

    serverProc.on("exit", (code) => {
      if (!started) reject(new Error(`Server exited with code ${code}`));
    });

    setTimeout(() => {
      if (!started) {
        started = true;
        resolve();
      }
    }, 15000);
  });
}

// ── Test-Pi Bridge Client ────────────────────────────────────────────

async function connectTestPiBridge() {
  log("Connecting test-pi bridge...");

  const wsUrl = `ws://127.0.0.1:${PI_PORT}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let connected = false;

    ws.on("open", () => {
      connected = true;
      log("Test-pi bridge connected.");

      for (const s of SESSIONS) {
        ws.send(
          JSON.stringify({
            type: "session_register",
            sessionId: s.sessionId,
            cwd: join(FIXTURE_CWDS_DIR, s.cwd),
            name: s.name,
            source: s.source,
            model: s.model,
            thinkingLevel: s.thinkingLevel,
            isNew: true,
            eventCount: s.eventCount,
            pid: s.pid,
            registerReason: "spawn",
          })
        );

        ws.send(
          JSON.stringify({
            type: "git_info_update",
            sessionId: s.sessionId,
            gitBranch: s.gitBranch,
            gitBranchUrl: s.gitBranchUrl,
          })
        );

        const events = EVENTS[s.sessionId] || [];
        for (const evt of events) {
          ws.send(
            JSON.stringify({
              type: "event_forward",
              sessionId: s.sessionId,
              event: evt,
            })
          );
        }

        ws.send(
          JSON.stringify({
            type: "replay_complete",
            sessionId: s.sessionId,
          })
        );
      }

      log("Test-pi replay sequence complete.");
      ws.close();
      resolve();
    });

    ws.on("error", (err) => {
      if (!connected) reject(err);
    });

    ws.on("close", () => {
      if (!connected) reject(new Error("WebSocket closed before connection"));
    });

    setTimeout(() => {
      if (!connected) reject(new Error("Test-pi bridge connection timed out"));
    }, 10000);
  });
}

// ── Seeded-State Readiness ───────────────────────────────────────────

async function verifySeededState() {
  log("Verifying seeded state...");

  const healthResp = await httpGet(`${BASE_URL}/api/health`);
  if (healthResp.status !== 200) {
    die(`Health check failed: status ${healthResp.status}`);
  }
  const health = JSON.parse(healthResp.body);

  if (health.bootstrap?.status === "installing") {
    warn("Bootstrap is installing — fixture mode should disable this.");
  }

  if (health.plugins && health.plugins.length > 0) {
    warn(`Unexpected plugins active: ${health.plugins.map((p) => p.id).join(", ")}`);
  }

  // Poll for sessions — bridge replay may take a moment to propagate
  const expectedIds = SESSIONS.map((s) => s.sessionId);
  const deadline = Date.now() + 15000;
  let allFound = false;

  while (Date.now() < deadline) {
    const sessionsResp = await httpGet(`${BASE_URL}/api/sessions`);
    if (sessionsResp.status !== 200) {
      await sleep(500);
      continue;
    }
    const sessions = JSON.parse(sessionsResp.body);
    const data = sessions?.data ?? sessions;
    if (!Array.isArray(data)) {
      await sleep(500);
      continue;
    }
    const foundIds = data.map((s) => s.id || s.sessionId);
    allFound = expectedIds.every((id) => foundIds.includes(id));
    if (allFound) {
      log(`Sessions visible: ${data.length} (all ${expectedIds.length} expected found)`);
      break;
    }
    log(`Waiting for sessions... found ${foundIds.length}/${expectedIds.length}`);
    await sleep(1000);
  }

  if (!allFound) {
    warn("Not all seeded sessions visible after replay — visual tests may capture empty state");
  }

  log("Seeded state verification complete.");
}

// ── Cleanup ──────────────────────────────────────────────────────────

async function cleanup() {
  log("Cleaning up...");

  if (serverProc) {
    try {
      serverProc.kill("SIGTERM");
      await sleep(2000);
      if (serverProc.exitCode === null) {
        serverProc.kill("SIGKILL");
      }
    } catch {
      // Already exited
    }
    serverProc = null;
  }

  await sleep(1000);
  if (!isPortFree(PORT)) {
    warn(`Port ${PORT} is still in use after cleanup.`);
  }
  if (!isPortFree(PI_PORT)) {
    warn(`Port ${PI_PORT} is still in use after cleanup.`);
  }

  if (existsSync(FIXTURE_DIR)) {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }

  log("Cleanup complete.");
}

// ── Signal Handling ──────────────────────────────────────────────────

function setupSignalHandlers() {
  const handler = async () => {
    log("Received interrupt — cleaning up.");
    await cleanup();
    process.exit(1);
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}

// ── WDIO Runner ──────────────────────────────────────────────────────

async function runWdio() {
  log("Starting WebdriverIO visual tests...");

  const env = {
    ...process.env,
    PI_DASHBOARD_BASE_URL: BASE_URL,
    PI_DASHBOARD_FIXTURE_MODE: "1",
    PI_DASHBOARD_FIXTURE_URL: BASE_URL,
  };

  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["wdio", "run", "./wdio.conf.ts"], {
      cwd: SUITE_DIR,
      env,
      stdio: "inherit",
    });

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`WDIO exited with code ${code}`));
    });

    proc.on("error", reject);
  });
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  log("=== Fixture Dashboard Launcher ===");
  log(`Suite dir: ${SUITE_DIR}`);
  log(`HTTP port: ${PORT}, Pi port: ${PI_PORT}`);
  log(`Mode: ${VALIDATE_ONLY ? "validate only" : SERVE_ONLY ? "serve only" : "full run"}`);

  setupSignalHandlers();

  try {
    checkPorts();
    setupDirectories();
    buildClientIfNeeded();
    await startServer();
    await waitForHealth(PORT, "Dashboard server");
    await waitForSpa(PORT);

    await connectTestPiBridge();

    await sleep(2000);
    await verifySeededState();

    if (VALIDATE_ONLY) {
      log("Validation only — skipping WDIO.");
      log("=== Fixture validated successfully ===");
      await cleanup();
      return;
    }

    if (SERVE_ONLY) {
      log("Serve only — keeping dashboard running.");
      log(`Dashboard: ${BASE_URL}`);
      log(`Pi gateway: ws://127.0.0.1:${PI_PORT}`);
      log("Press Ctrl+C to stop.");
      await new Promise(() => {});
      return;
    }

    await runWdio();
    log("=== Visual tests complete ===");
  } catch (err) {
    die(err.message || String(err));
  } finally {
    await cleanup();
  }
}

main();

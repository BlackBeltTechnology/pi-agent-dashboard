#!/usr/bin/env node
/**
 * PI Dashboard Server CLI
 *
 * Usage:
 *   pi-dashboard                    Start server in foreground (default)
 *   pi-dashboard start [flags]      Start server as background daemon
 *   pi-dashboard stop               Stop running daemon
 *   pi-dashboard restart [flags]    Restart daemon
 *   pi-dashboard status             Show daemon status
 *
 * Flags:
 *   --port <n>       HTTP port (default: 8000)
 *   --pi-port <n>    Pi gateway port (default: 9999)
 *   --dev            Development mode (skip static files)
 *   --no-tunnel      Disable zrok tunnel
 */
// `createServer` is imported dynamically inside `runForeground()` so a
// top-level module-resolution failure (missing `fastify` etc.) can be
// caught and degraded into the recovery HTTP server instead of crashing
// the process. The type-only import here is fully erased at runtime.
import type { createServer as _CreateServerType, ServerConfig } from "./server.js";
import {
  startRecoveryServer,
  isModuleNotFoundError,
  parseModuleNotFoundError,
} from "./lifecycle/recovery-server.js";
import { loadConfig, ensureConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import {
  launchDashboardServer,
  JitiNotFoundError,
  PortConflictError,
  EarlyExitError,
} from "@blackbelt-technology/pi-dashboard-shared/server-launcher.js";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { readPid, removePid, isServerRunning } from "./spawn-process/server-pid.js";
import {
  findPortHolders as platformFindPortHolders,
  isProcessAlive as platformIsProcessAlive,
  killProcess as platformKillProcess,
  parseNetstatListeners as platformParseNetstatListeners,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";

// Re-exports for back-compat — other modules / tests may import these from cli.
export const parseNetstatListeners = platformParseNetstatListeners;
export function findPortHolders(
  port: number,
  execImpl?: (cmd: string, opts: { encoding: "utf-8" }) => string,
): number[] {
  return platformFindPortHolders(port, execImpl ? { exec: execImpl } : undefined);
}
import { isDashboardRunning } from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";
import { discoverDashboard } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";

import { assertNodeVersionSupported } from "./auth/node-guard.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import {
  findBundledExtension,
  registerBridgeExtension,
} from "@blackbelt-technology/pi-dashboard-shared/bridge-register.js";
import { parseDashboardStarter } from "@blackbelt-technology/pi-dashboard-shared/dashboard-starter.js";

const SUBCOMMANDS = ["start", "stop", "restart", "status"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

export interface ParsedArgs {
  subcommand: Subcommand | null;
  flags: Partial<ServerConfig>;
}

/**
 * Parse CLI arguments into a subcommand + flags.
 * Exported for testing.
 */
export function parseArgs(args: string[]): ParsedArgs {
  const flags: Partial<ServerConfig> = {};
  let subcommand: Subcommand | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    // Check for subcommand (first positional arg)
    if (!subcommand && SUBCOMMANDS.includes(arg as Subcommand)) {
      subcommand = arg as Subcommand;
      continue;
    }

    if (arg === "--port" && next) {
      flags.port = parseInt(next, 10);
      i++;
    } else if (arg === "--host" && next && !next.startsWith("--")) {
      flags.host = next;
      i++;
    } else if (arg === "--pi-port" && next) {
      flags.piPort = parseInt(next, 10);
      i++;
    } else if (arg === "--dev") {
      flags.dev = true;
    } else if (arg === "--no-tunnel") {
      flags.tunnel = false;
    }
  }

  return { subcommand, flags };
}

/**
 * Build the full server config from CLI flags, env vars, and config file.
 */
export function buildConfig(flags: Partial<ServerConfig>): ServerConfig {
  const fileConfig = loadConfig();
  return {
    port: flags.port ?? (parseInt(process.env.PI_DASHBOARD_PORT ?? "") || null) ?? fileConfig.port,
    piPort: flags.piPort ?? (parseInt(process.env.PI_DASHBOARD_PI_PORT ?? "") || null) ?? fileConfig.piPort,
    host: flags.host ?? (process.env.PI_DASHBOARD_HOST || null) ?? fileConfig.bindHost,
    dev: flags.dev ?? false,
    autoShutdown: fileConfig.autoShutdown,
    shutdownIdleSeconds: fileConfig.shutdownIdleSeconds,
    tunnel: flags.tunnel ?? fileConfig.tunnel.enabled,
    // v2 (support-zrok-v2): source the reserved NAME + persistence from the
    // zrok sub-config. The legacy v1 `reservedToken` is NOT passed to the v2
    // provider (a v1 token is meaningless to a v2 account).
    tunnelReservedName: fileConfig.tunnel.zrok?.reservedName,
    tunnelPersistent: fileConfig.tunnel.zrok?.persistent,
    tunnelWatchdog: fileConfig.tunnel.watchdog,
    authConfig: fileConfig.auth,
    maxEventsPerSession: fileConfig.memoryLimits.maxEventsPerSession,
    maxStringFieldSize: fileConfig.memoryLimits.maxStringFieldSize,
    maxWsBufferBytes: fileConfig.memoryLimits.maxWsBufferBytes,
    openspec: fileConfig.openspec,
    sessions: fileConfig.sessions,
    reattachPlacement: fileConfig.reattachPlacement,
    completedFirst: fileConfig.completedFirst,
    questionFirst: fileConfig.questionFirst,
    resolvedTrustedNetworks: fileConfig.resolvedTrustedNetworks,
    corsAllowedOrigins: fileConfig.cors.allowedOrigins,
  };
}

/**
 * Run the server in the foreground.
 *
 * Pi/openspec/tsx ship as regular npm deps of this package, so the
 * ToolRegistry resolve of "pi" at startup either succeeds (regular
 * path) or signals a corrupted install (hard error). See change:
 * eliminate-electron-runtime-install.
 */
async function runForeground(config: ServerConfig): Promise<void> {
  assertNodeVersionSupported();

  // Dynamic-import boundary for the main server module. If a top-level
  // dependency (fastify, toad-cache, readable-stream, …) is missing, the
  // import throws ERR_MODULE_NOT_FOUND here — caught and degraded to the
  // recovery HTTP server bound to the same port.
  let createServer: typeof _CreateServerType;
  try {
    ({ createServer } = await import("./server.js"));
  } catch (err) {
    if (isModuleNotFoundError(err)) {
      await startRecoveryServer({
        port: config.port,
        error: err as Error,
        missingModule: parseModuleNotFoundError(err),
      });
      // startRecoveryServer never returns — its HTTP server keeps the
      // event loop alive until the user clicks Retry (which respawns and
      // process.exits) or the process is killed externally.
      return new Promise<void>(() => { /* unreachable */ });
    }
    throw err;
  }

  const server = await createServer(config);

  // Tool-registry resolve confirms pi is reachable from the bundled
  // node_modules/ — under change: eliminate-electron-runtime-install,
  // pi/openspec/tsx ship as regular deps so the registry must resolve
  // at startup. A miss here means the install tree is corrupted.
  {
    const registry = getDefaultRegistry();
    const res = registry.resolve("pi");
    if (res.ok) {
      console.log(`[bootstrap] ready (pi resolved via ${res.source})`);
    } else {
      const tried = res.tried?.map((t: any) => t.strategy).join(", ") ?? "(no strategies)";
      throw new Error(
        `[bootstrap] pi is not resolvable from the dashboard install. ` +
        `This indicates a corrupted node_modules/ tree. Tried: ${tried}. ` +
        `Reinstall the dashboard (npm i -g @blackbelt-technology/pi-agent-dashboard) ` +
        `or reinstall the Electron app.`,
      );
    }
  }

  // One-time advisory: legacy `~/.pi-dashboard/` directory left behind
  // from pre-R3 versions. Nothing reads or writes it now — surface a
  // single log line so the user knows it's safe to delete. Doctor UI
  // shows the same advisory more visibly.
  try {
    const { detectLegacyManagedDir } = await import(
      "@blackbelt-technology/pi-dashboard-shared/legacy-managed-dir.js"
    );
    const legacy = detectLegacyManagedDir();
    if (legacy.present) {
      console.log(
        `[legacy] legacy install directory detected at ${legacy.path} ` +
        `(${legacy.pkgCount} packages, ~${legacy.sizeMb} MB). No longer used — safe to delete.`,
      );
    }
  } catch {
    /* advisory only — never block startup */
  }

  await server.start();
}


/**
 * Start the server as a detached background daemon.
 */
async function cmdStart(config: ServerConfig): Promise<void> {
  assertNodeVersionSupported();
  const running = await isServerRunning(config.port);
  if (running) {
    console.log(`Dashboard server is already running (pid ${running})`);
    return;
  }

  // Check if port is occupied by another service
  const portStatus = await isDashboardRunning(config.port);
  if (portStatus.portConflict) {
    console.error(`Port ${config.port} is occupied by another service (not the dashboard).`);
    console.error(`Change the port in ~/.pi/dashboard/config.json or use --port <n>`);
    process.exit(1);
  }

  // Spawn ourselves in foreground mode (no subcommand) as a detached process.
  // All concerns below — jiti loader resolution, --import argv URL-wrapping,
  // env merge, log-file header, readiness polling, port-conflict / early-exit
  // detection — are owned by the shared `launchDashboardServer` primitive.
  const cliPath = fileURLToPath(import.meta.url);
  const args: string[] = [];
  if (config.port !== 8000) args.push("--port", String(config.port));
  if (config.piPort !== 9999) args.push("--pi-port", String(config.piPort));
  if (config.dev) args.push("--dev");
  if (!config.tunnel) args.push("--no-tunnel");

  const logDir = path.join(os.homedir(), ".pi", "dashboard");
  const logPath = path.join(logDir, "server.log");

  try {
    const result = await launchDashboardServer({
      cliPath,
      extraArgs: args,
      stdio: { logFile: logPath },
      starter: "Standalone",
      healthTimeoutMs: 30_000,
      port: config.port,
    });
    const reportedPid = result.reportedPid ?? readPid() ?? result.childPid;
    console.log(`Dashboard server started (pid ${reportedPid}) at http://localhost:${config.port}`);
  } catch (err: unknown) {
    if (err instanceof JitiNotFoundError) {
      console.error(`[pi-dashboard] ${err.message}`);
      process.exit(1);
    }
    if (err instanceof PortConflictError) {
      console.error(`Port ${err.port} is occupied by another service (not the dashboard).`);
      console.error(`Change the port in ~/.pi/dashboard/config.json or use --port <n>`);
      process.exit(1);
    }
    if (err instanceof EarlyExitError) {
      console.error(`Failed to start dashboard server (child process exited with code ${err.code})`);
      console.error(`Check logs at ${logPath}`);
      process.exit(1);
    }
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`Failed to start dashboard server (${reason})`);
    console.error(`Check logs at ${logPath}`);
    process.exit(1);
  }
}

/**
 * Stop the running server daemon.
 */
/**
 * Kill a process by PID with logging. Delegates to the shared platform
 * primitive (`packages/shared/src/platform/process.ts`) which handles the
 * Windows (taskkill) vs Unix (SIGTERM→SIGKILL) split.
 * See change: consolidate-platform-handlers.
 */
async function killProcess(pid: number, label: string): Promise<boolean> {
  const result = await platformKillProcess(pid);
  if (!result.ok) return false;
  console.log(`${label} stopped${result.forced ? " (forced)" : ""} (pid ${pid})`);
  return true;
}

// Local alias to preserve prior internal references.
const isProcessAlive = (pid: number) => platformIsProcessAlive(pid);

async function cmdStop(): Promise<void> {
  const config = loadConfig();
  const pid = readPid();
  let stopped = false;

  // Try PID file first
  if (pid !== null) {
    if (isProcessAlive(pid)) {
      stopped = await killProcess(pid, "Dashboard server");
    } else {
      console.log("Dashboard server is not running (cleaned up stale PID file)");
    }
    removePid();
  }

  // Safety net: kill any process still holding our ports
  for (const port of [config.port, config.piPort]) {
    for (const holder of findPortHolders(port)) {
      if (holder !== pid) {
        console.log(`Killing stale process ${holder} on port ${port}`);
        await killProcess(holder, `Stale process on port ${port}`);
      }
    }
  }

  if (!stopped && pid === null) {
    console.log("Dashboard server is not running");
  }
}

/**
 * `pi-dashboard restart` — restart the daemon.
 *
 * If a dashboard is currently running, POST to `/api/restart` so the proven
 * `restart-helper.ts` orchestrator handles the stop/start atomically in a
 * detached child. This avoids the bridge-auto-start race that occurs when
 * `cmdStop()` kills the daemon in-process: every connected bridge sees its
 * WS close and fires `server-auto-start.ts`, racing the subsequent
 * `cmdStart()` to bind the port.
 *
 * If the dashboard is NOT running (or is unreachable), fall back to the
 * existing `cmdStop()` + `cmdStart()` sequence.
 *
 * See change: fix-restart-bridge-auto-start-race.
 */
export async function cmdRestart(
  config: ServerConfig,
  injected?: {
    isDashboardRunning?: typeof isDashboardRunning;
    fetchImpl?: typeof fetch;
    cmdStopImpl?: () => Promise<void>;
    cmdStartImpl?: (cfg: ServerConfig) => Promise<void>;
  },
): Promise<void> {
  const probe = injected?.isDashboardRunning ?? isDashboardRunning;
  const fetchFn = injected?.fetchImpl ?? fetch;
  const stopFn = injected?.cmdStopImpl ?? cmdStop;
  const startFn = injected?.cmdStartImpl ?? cmdStart;
  return cmdRestartImpl(config, probe, fetchFn, stopFn, startFn);
}

async function cmdRestartImpl(
  config: ServerConfig,
  probe: typeof isDashboardRunning,
  fetchFn: typeof fetch,
  stopFn: () => Promise<void>,
  startFn: (cfg: ServerConfig) => Promise<void>,
): Promise<void> {
  const status = await probe(config.port);
  if (status.running) {
    console.log(
      `[restart] dashboard running at http://localhost:${config.port}, delegating to /api/restart`,
    );
    try {
      const res = await fetchFn(`http://localhost:${config.port}/api/restart`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dev: !!config.dev }),
      });
      if (res.ok) {
        console.log("[restart] orchestrator queued; CLI exits now.");
        return;
      }
      const body = await res.text();
      console.error(
        `[restart] server rejected restart: HTTP ${res.status} ${body}; falling back to local stop/start`,
      );
    } catch (err) {
      console.error(
        `[restart] failed to reach server (${(err as Error).message ?? err}); falling back to local stop/start`,
      );
    }
    // Fall through to local sequence on HTTP failure so the user is never
    // left with a half-restarted server.
  }
  await stopFn();
  await startFn(config);
}

/**
 * Show server status.
 */

async function cmdStatus(port: number): Promise<void> {
  // 1. Try mDNS discovery first
  try {
    const servers = await discoverDashboard(2000);
    const local = servers.find(s => s.isLocal);
    if (local) {
      // Verify via health check for uptime info
      try {
        const res = await fetch(`http://${local.host}:${local.port}/api/health`);
        if (res.ok) {
          const data = await res.json() as { pid: number; uptime: number };
          console.log(`Dashboard server is running (pid ${data.pid}) on ${local.host}:${local.port}, uptime ${data.uptime}s (discovered via mDNS)`);
          return;
        }
      } catch { /* fall through */ }
      console.log(`Dashboard server discovered via mDNS at ${local.host}:${local.port} (pid ${local.pid})`);
      return;
    }
  } catch {
    // mDNS failed — fall through to PID file check
  }

  // 2. Fallback: PID file + health check
  const pid = readPid();

  if (pid === null) {
    console.log("Dashboard server is not running");
    process.exit(1);
    return;
  }

  if (!isProcessAlive(pid)) {
    removePid();
    console.log("Dashboard server is not running (cleaned up stale PID file)");
    process.exit(1);
    return;
  }

  // Try health endpoint for richer info
  try {
    const res = await fetch(`http://localhost:${port}/api/health`);
    if (res.ok) {
      const data = await res.json() as { pid: number; uptime: number };
      console.log(`Dashboard server is running (pid ${data.pid}) on port ${port}, uptime ${data.uptime}s`);
      return;
    }
  } catch {
    // Fall back to basic info
  }

  console.log(`Dashboard server is running (pid ${pid}) on port ${port}`);
}

/**
 * Install process-level safety net so a single misbehaving plugin or
 * library cannot kill the whole dashboard. Logs the offending error and
 * keeps the event loop running. We do NOT exit; the surrounding daemon
 * harness already restarts on real crashes (signal/exit-code), and
 * silently swallowing recoverable async faults is the lesser evil here.
 */
function installCrashSafetyNet(): void {
  process.on("unhandledRejection", (reason: unknown) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error("[crash-safety] unhandledRejection (suppressed):", err.stack || err.message);
  });
  process.on("uncaughtException", (err: Error) => {
    console.error("[crash-safety] uncaughtException (suppressed):", err.stack || err.message);
  });
}

async function main() {
  installCrashSafetyNet();
  ensureConfig();

  const { subcommand, flags } = parseArgs(process.argv.slice(2));
  const config = buildConfig(flags);

  switch (subcommand) {
    case "start":
      await cmdStart(config);
      break;
    case "stop":
      await cmdStop();
      break;
    case "restart":
      await cmdRestart(config);
      break;
    case "status":
      await cmdStatus(config.port);
      break;
    default:
      // No subcommand — run in foreground (backward compatible)
      await runForeground(config);
      break;
  }
}

// Only run when executed directly (not when imported for testing)
const isDirectExecution = process.argv[1] &&
  (process.argv[1].endsWith("cli.ts") || process.argv[1].endsWith("cli.js") || process.argv[1].endsWith("pi-dashboard"));

if (isDirectExecution) {
  main().catch((err) => {
    console.error("Failed to start dashboard:", err);
    process.exit(1);
  });
}

#!/usr/bin/env node --import tsx
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
import { createServer, type ServerConfig } from "./server.js";
import { loadConfig, ensureConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPid, removePid, isServerRunning } from "./server-pid.js";
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
import { resolveJitiImport } from "@blackbelt-technology/pi-dashboard-shared/resolve-jiti.js";
import { assertNodeVersionSupported } from "./node-guard.js";

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
    dev: flags.dev ?? false,
    autoShutdown: fileConfig.autoShutdown,
    shutdownIdleSeconds: fileConfig.shutdownIdleSeconds,
    tunnel: flags.tunnel ?? fileConfig.tunnel.enabled,
    tunnelReservedToken: fileConfig.tunnel.reservedToken,
    authConfig: fileConfig.auth,
    maxEventsPerSession: fileConfig.memoryLimits.maxEventsPerSession,
    maxStringFieldSize: fileConfig.memoryLimits.maxStringFieldSize,
    maxWsBufferBytes: fileConfig.memoryLimits.maxWsBufferBytes,
    editor: fileConfig.editor,
    resolvedTrustedNetworks: fileConfig.resolvedTrustedNetworks,
    corsAllowedOrigins: fileConfig.cors.allowedOrigins,
  };
}

/**
 * Run the server in the foreground (original behavior).
 */
async function runForeground(config: ServerConfig): Promise<void> {
  assertNodeVersionSupported();
  const server = await createServer(config);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      console.log("Force exit.");
      process.exit(1);
    }
    shuttingDown = true;
    console.log("\nShutting down...");
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

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

  // Spawn ourselves in foreground mode (no subcommand) as a detached process
  const cliPath = fileURLToPath(import.meta.url);
  const args: string[] = [];
  if (config.port !== 8000) args.push("--port", String(config.port));
  if (config.piPort !== 9999) args.push("--pi-port", String(config.piPort));
  if (config.dev) args.push("--dev");
  if (!config.tunnel) args.push("--no-tunnel");

  let tsLoader: string;
  try {
    tsLoader = resolveJitiImport();
  } catch {
    // Fallback to tsx when jiti is not available (e.g. running outside pi).
    // The loader is passed to `node --import`; on Windows, Node >= 20 rejects
    // raw absolute paths with a drive letter (parsed as URL scheme), so we
    // return a file:// URL. See change: fix-windows-server-parity.
    try {
      const tsxMain = createRequire(cliPath).resolve("tsx");
      const tsxLoaderPath = path.join(path.dirname(tsxMain), "esm", "index.mjs");
      tsLoader = pathToFileURL(tsxLoaderPath).href;
    } catch {
      console.error(
        "[pi-dashboard] Cannot find TypeScript loader. " +
        "Install tsx (`npm install`) or run inside a pi session."
      );
      process.exit(1);
    }
  }

  // Redirect daemon stdout/stderr to a log file for crash diagnosis.
  // Log is opened in append mode ("a") so output from prior start attempts
  // is preserved across retries — critical for diagnosing intermittent or
  // silent launch failures. A timestamped header line distinguishes runs.
  // See change: fix-windows-server-parity.
  const logDir = path.join(os.homedir(), ".pi", "dashboard");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, "server.log");
  const logFd = fs.openSync(logPath, "a");
  fs.writeSync(
    logFd,
    `\n[${new Date().toISOString()}] pi-dashboard start (parent pid ${process.pid}, port ${config.port})\n`,
  );

  // tsLoader is a file:// URL (required on Windows for node --import).
  // See change: fix-windows-server-parity.
  const child = spawn(process.execPath, ["--import", tsLoader, cliPath, ...args], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env },
  });
  child.unref();
  // Close the parent's copy of the fd — child has its own via stdio inheritance.
  try { fs.closeSync(logFd); } catch { /* ignore */ }

  // Wait for dashboard to become available (up to 5 seconds)
  const deadline = Date.now() + 5000;
  let started = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    const status = await isDashboardRunning(config.port);
    if (status.running) {
      started = true;
      break;
    }
  }

  if (started) {
    const pid = readPid();
    console.log(`Dashboard server started (pid ${pid ?? child.pid}) at http://localhost:${config.port}`);
  } else {
    console.error("Failed to start dashboard server (timed out after 5s)");
    console.error(`Check logs at ${path.join(logDir, "server.log")}`);
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

async function main() {
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
      await cmdStop();
      await cmdStart(config);
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

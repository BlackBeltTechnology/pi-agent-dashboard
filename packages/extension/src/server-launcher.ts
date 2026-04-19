/**
 * Server launcher — spawns the dashboard server as a detached process.
 * The spawned server runs in foreground mode (no subcommand) and writes
 * its own PID file at ~/.pi/dashboard/server.pid.
 */
import { spawnDetached, waitForReady } from "@blackbelt-technology/pi-dashboard-shared/platform/detached-spawn.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { DashboardConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { resolveJitiImport } from "@blackbelt-technology/pi-dashboard-shared/resolve-jiti.js";
import { isDashboardRunning } from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export interface LaunchResult {
  success: boolean;
  message: string;
}

/**
 * Resolve the dashboard server CLI script path.
 *
 * Handles two layouts:
 *   1. Monorepo dev: `<repo>/packages/extension/src/` → `<repo>/packages/server/src/cli.ts`
 *   2. Installed  : `<x>/node_modules/@blackbelt-technology/pi-dashboard-extension/src/`
 *                → `<x>/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts`
 *
 * Uses Node's module resolver (`require.resolve`) to find the server package
 * and joins `src/cli.ts`. Falls back to the monorepo-relative path so existing
 * dev workflows keep working even if the server package isn't resolvable (e.g.
 * a pristine checkout with no node_modules yet).
 */
export function resolveServerCliPath(): string {
  try {
    const serverPkgJson = require.resolve("@blackbelt-technology/pi-dashboard-server/package.json");
    return path.resolve(path.dirname(serverPkgJson), "src", "cli.ts");
  } catch {
    // Dev-repo fallback: <extension>/src/../../server/src/cli.ts
    return path.resolve(__dirname, "..", "..", "server", "src", "cli.ts");
  }
}

/**
 * Build the spawn arguments from config.
 */
export function buildSpawnArgs(config: DashboardConfig): string[] {
  return [
    "--port", String(config.port),
    "--pi-port", String(config.piPort),
  ];
}

/**
 * Launch the dashboard server as a detached background process.
 * Returns success/failure after a brief wait to detect early crashes.
 */
export async function launchServer(config: DashboardConfig): Promise<LaunchResult> {
  const cliPath = resolveServerCliPath();
  const args = buildSpawnArgs(config);

  try {
    // Open the server.log in append mode so any startup error is visible.
    // Matches the log location used by `pi-dashboard start`.
    let logFd: number | undefined;
    try {
      const logDir = path.join(os.homedir(), ".pi", "dashboard");
      fs.mkdirSync(logDir, { recursive: true });
      const logPath = path.join(logDir, "server.log");
      logFd = fs.openSync(logPath, "a");
      fs.writeSync(
        logFd,
        `\n[${new Date().toISOString()}] bridge auto-start (parent pid ${process.pid}, port ${config.port})\n`,
      );
    } catch { /* if we can't open the log, spawn still works */ }

    // Spawn server via the detached-spawn primitive. resolveJitiImport()
    // returns a file:// URL (required on Windows for node --import).
    const r = await spawnDetached({
      cmd: process.execPath,
      args: ["--import", resolveJitiImport(), cliPath, ...args],
      env: { ...process.env },
      logFd,
    });

    // Close the parent's copy of the log fd — the child has its own.
    if (logFd !== undefined) {
      try { fs.closeSync(logFd); } catch { /* ignore */ }
    }

    if (!r.ok || !r.process) {
      return { success: false, message: `Server process failed to spawn: ${r.error ?? "unknown"}` };
    }

    // Wait for the server to actually become available (positive probe),
    // not just "didn't crash in 2s". Fastify boot on Windows can take
    // 3–6s with jiti compiling CJS deps; a 2s window is too short and
    // would report success even when the server crashes at 3s with
    // ERR_INTERNAL_ASSERTION in Fastify's ajv-compiler. Positive probe
    // guarantees a user-visible "Dashboard started" message only fires
    // when the HTTP server is actually accepting connections.
    const ready = await waitForReady({
      probe: async () => (await isDashboardRunning(config.port)).running,
      deadlineMs: 15_000,
      pollIntervalMs: 300,
      child: r.process,
    });

    if (!ready.ok) {
      return {
        success: false,
        message: `Server failed to become ready within 15s (${ready.error}). See ~/.pi/dashboard/server.log`,
      };
    }

    return { success: true, message: "Server started" };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

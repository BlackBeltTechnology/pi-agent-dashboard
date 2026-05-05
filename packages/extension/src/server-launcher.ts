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
import { toFileUrl, shouldUrlWrapEntry } from "@blackbelt-technology/pi-dashboard-shared/platform/node-spawn.js";
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
 * Build the environment object passed to the spawned server process.
 * Always stamps DASHBOARD_STARTER=Bridge so the server knows it was
 * launched by the pi bridge extension.
 */
export function buildSpawnEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  // Spread process.env (may contain undefined values); filter them out.
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (v !== undefined) out[k] = v;
  }
  out["DASHBOARD_STARTER"] = "Bridge";
  return out;
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

    // Spawn server via the detached-spawn primitive. The loader is always
    // URL-wrapped (Node needs file:// for --import on Windows drive letters).
    // The entry is URL-wrapped only on Windows + non-tsx loader (Node parses
    // drive letters as URL schemes in argv); on POSIX the entry MUST be raw
    // because jiti's resolver misbehaves on file:// URL entries. See
    // openspec/changes/archive/2026-04-24-fix-windows-entry-script-url.
    const loader = resolveJitiImport();
    const wrapEntry = shouldUrlWrapEntry(loader);
    // entry is gated by shouldUrlWrapEntry(loader): returns true only on
    // Windows + non-tsx (where URL wrap is required); false on POSIX
    // where jiti needs the raw path (file:// URL entries trigger jiti's
    // `<cwd>/file:/...` misresolution bug).
    const entry = wrapEntry ? toFileUrl(cliPath) : cliPath;
    const r = await spawnDetached({
      cmd: process.execPath,
      args: ["--import", loader, entry, ...args], // ban:raw-node-import-ok: entry gated by shouldUrlWrapEntry
      env: { ...process.env, DASHBOARD_STARTER: "Bridge" },
      logFd,
    });

    // Close the parent's copy of the log fd — the child has its own.
    if (logFd !== undefined) {
      try { fs.closeSync(logFd); } catch { /* ignore */ }
    }

    if (!r.ok || !r.process) {
      return { success: false, message: `Server process failed to spawn: ${r.error ?? "unknown"}` };
    }

    // Wait for the server to actually become available via positive
    // HTTP probe. NO deadline — we rely on child-exit for failure
    // detection. A timeout here only catches the pathological case
    // "process alive but never ready", which is rarer than the
    // false-positive case "slow cold-start mistakenly flagged as
    // failure" (Fastify + jiti compile + session scan can take 15–30s
    // on Windows). If the child crashes, `waitForReady` returns
    // { ok: false, error: "child exited with code N" } via its
    // `child` listener. If the child hangs alive-but-broken, the user
    // can kill it manually — timers don't help that case anyway.
    const ready = await waitForReady({
      probe: async () => (await isDashboardRunning(config.port)).running,
      pollIntervalMs: 300,
      child: r.process,
      // deadlineMs intentionally omitted — wait indefinitely.
    });

    if (!ready.ok) {
      return {
        success: false,
        message: `Server process failed: ${ready.error ?? "unknown"}. See ~/.pi/dashboard/server.log`,
      };
    }

    return { success: true, message: "Server started" };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

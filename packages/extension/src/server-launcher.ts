/**
 * Server launcher — spawns the dashboard server as a detached process.
 * The spawned server runs in foreground mode (no subcommand) and writes
 * its own PID file at ~/.pi/dashboard/server.pid.
 */
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { DashboardConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { getDashboardServerLogPath } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import {
  launchDashboardServer,
  JitiNotFoundError,
  PortConflictError,
  EarlyExitError,
} from "@blackbelt-technology/pi-dashboard-shared/server-launcher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export interface LaunchResult {
  success: boolean;
  message: string;
  /**
   * PID of the spawned child process when `success === true`. Surfaces
   * `launchDashboardServer`'s underlying `childPid` so callers (e.g. the
   * bridge) can register self-spawned PIDs into their exclusion set
   * synchronously after launch. See change: tighten-process-list-ux.
   */
  childPid?: number;
  /**
   * Whether the spawn reached the log-owning path (i.e. `launchDashboardServer`
   * opened `~/.pi/dashboard/server.log` before failing). `false` only for
   * failures that abort BEFORE the log fd is opened (currently just
   * `JitiNotFoundError` — loader resolution precedes log creation). Callers use
   * this to avoid pointing users at a `server.log` that was never written.
   * See change: fix-bridge-server-start-diagnostics (CodeRabbit #3).
   */
  logOwned?: boolean;
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
 * Delegates to the shared `launchDashboardServer` primitive which owns
 * loader resolution, argv shape, env merge, log-file policy, and
 * readiness polling (see `packages/shared/src/server-launcher.ts`).
 *
 * Bridge-specific contract: `DASHBOARD_STARTER=Bridge`,
 * `stdio: { logFile: getDashboardServerLogPath() }` (Bridge auto-spawn
 * now owns the shared `~/.pi/dashboard/server.log` so a slow/crashed
 * cold start leaves an inspectable log), and a 10 s cold-start health
 * timeout (slow hosts reach `writePid()` but are not health-OK within
 * 2 s; `EarlyExitError` still surfaces a real crash instantly).
 * See change: fix-bridge-server-start-diagnostics.
 */
export async function launchServer(config: DashboardConfig): Promise<LaunchResult> {
  const cliPath = resolveServerCliPath();
  const args = buildSpawnArgs(config);

  try {
    const result = await launchDashboardServer({
      cliPath,
      extraArgs: args,
      stdio: { logFile: getDashboardServerLogPath() },
      healthTimeoutMs: 10_000,
      port: config.port,
      starter: "Bridge",
    });
    return { success: true, message: "Server started", childPid: result.childPid, logOwned: true };
  } catch (err: unknown) {
    if (err instanceof JitiNotFoundError) {
      // Thrown before the log fd is opened — no server.log exists.
      return { success: false, message: err.message, logOwned: false };
    }
    if (err instanceof PortConflictError) {
      return { success: false, message: err.message, logOwned: true };
    }
    if (err instanceof EarlyExitError) {
      return {
        success: false,
        message: `Server process exited (code=${err.code}) before health check. See ${getDashboardServerLogPath()}`,
        logOwned: true,
      };
    }
    // Readiness timeout (and any other post-spawn error): the log was opened
    // before the readiness loop, so it exists and is worth pointing at.
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message, logOwned: true };
  }
}

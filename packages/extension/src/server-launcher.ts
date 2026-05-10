/**
 * Server launcher — spawns the dashboard server as a detached process.
 * The spawned server runs in foreground mode (no subcommand) and writes
 * its own PID file at ~/.pi/dashboard/server.pid.
 */
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { DashboardConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { buildMaxHeapArgs } from "@blackbelt-technology/pi-dashboard-shared/config.js";
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
 * Bridge-specific contract preserved: `DASHBOARD_STARTER=Bridge`,
 * `stdio: "ignore"` (Bridge auto-spawn never owns the log file),
 * 2 s health timeout (Bridge expects a fast cold-start when the
 * server is already on the same machine).
 */
export async function launchServer(config: DashboardConfig): Promise<LaunchResult> {
  const cliPath = resolveServerCliPath();
  const args = buildSpawnArgs(config);

  try {
    await launchDashboardServer({
      cliPath,
      extraArgs: args,
      nodeArgs: buildMaxHeapArgs(config.memoryLimits),
      stdio: "ignore",
      healthTimeoutMs: 2_000,
      port: config.port,
      starter: "Bridge",
    });
    return { success: true, message: "Server started" };
  } catch (err: unknown) {
    if (err instanceof JitiNotFoundError) {
      return { success: false, message: err.message };
    }
    if (err instanceof PortConflictError) {
      return { success: false, message: err.message };
    }
    if (err instanceof EarlyExitError) {
      return {
        success: false,
        message: `Server process exited (code=${err.code}) before health check. See ~/.pi/dashboard/server.log`,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message };
  }
}

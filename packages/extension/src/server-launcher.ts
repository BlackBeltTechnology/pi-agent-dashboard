/**
 * Server launcher — spawns the dashboard server as a detached process.
 * The spawned server runs in foreground mode (no subcommand) and writes
 * its own PID file at ~/.pi/dashboard/server.pid.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { DashboardConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { resolveJitiImport } from "@blackbelt-technology/pi-dashboard-shared/resolve-jiti.js";

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
    // Spawn server using pi's jiti TypeScript loader (resolved to absolute path).
    // The server writes its own PID file on startup, so
    // `pi-dashboard status` can detect it.
    const child = spawn(process.execPath, ["--import", resolveJitiImport(), cliPath, ...args], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });

    child.unref();

    // Monitor for early exit (within 2s)
    const earlyExit = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        resolve(false); // No early exit — server is running
      }, 2000);

      child.on("exit", () => {
        clearTimeout(timer);
        resolve(true); // Exited early — failure
      });

      child.on("error", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

    if (earlyExit) {
      return { success: false, message: "Server process exited immediately" };
    }

    return { success: true, message: "Server started" };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

/**
 * PID file management for the dashboard server process.
 * Writes/reads/removes ~/.pi/dashboard/server.pid to track the running server.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { isDashboardRunning } from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";
import { isProcessAlive } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";

const DEFAULT_PID_PATH = path.join(os.homedir(), ".pi", "dashboard", "server.pid");

export interface ServerPidOptions {
  pidPath?: string;
}

/**
 * Re-export the platform's liveness primitive so existing importers of
 * `server-pid.ts::isProcessAlive` keep working. See change:
 * route-kill-paths-through-platform.
 */
export { isProcessAlive };

/**
 * Write the current process PID to the PID file.
 */
export function writePid(pid: number, options?: ServerPidOptions): void {
  const pidPath = options?.pidPath ?? DEFAULT_PID_PATH;
  const dir = path.dirname(pidPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(pidPath, String(pid) + "\n");
}

/**
 * Read the PID from the PID file. Returns null if file doesn't exist or is invalid.
 */
export function readPid(options?: ServerPidOptions): number | null {
  const pidPath = options?.pidPath ?? DEFAULT_PID_PATH;
  try {
    const content = fs.readFileSync(pidPath, "utf-8").trim();
    const pid = parseInt(content, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Remove the PID file.
 */
export function removePid(options?: ServerPidOptions): void {
  const pidPath = options?.pidPath ?? DEFAULT_PID_PATH;
  try {
    fs.unlinkSync(pidPath);
  } catch {
    // File may not exist — that's fine
  }
}

/**
 * Check if the dashboard server is currently running.
 * Returns the PID if running, null otherwise.
 * Cleans up stale PID files automatically.
 */
export async function isServerRunning(port: number, options?: ServerPidOptions): Promise<number | null> {
  const pid = readPid(options);

  if (pid === null) return null;

  // Process alive — verify it's actually our server via health check
  if (isProcessAlive(pid)) {
    const status = await isDashboardRunning(port);
    if (status.running) return pid;
    // Process alive but dashboard not responding — could be a recycled PID, treat as stale
  }

  // Stale PID file — clean up
  removePid(options);
  return null;
}

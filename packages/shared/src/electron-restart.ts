/**
 * `/api/restart` on an Electron-owned server hands the restart to the app:
 * the server exits with `ELECTRON_RESTART_EXIT_CODE` and the Electron
 * watchdog respawns it through its own runtime path. The detached `cli start`
 * orchestrator would come back as Standalone (lost starter, runtime identity
 * and watchdog). See change: electron-runtime-overlay-updates.
 */
import { parseLaunchSource } from "./dashboard-starter.js";

export const ELECTRON_RESTART_EXIT_CODE = 75;

/** True for a server started by the Electron app (starter + per-launch owner token). */
export function restartsViaElectron(env: Record<string, string | undefined>): boolean {
  return parseLaunchSource(env) === "electron" && !!env.PI_DASHBOARD_ELECTRON_INSTANCE;
}

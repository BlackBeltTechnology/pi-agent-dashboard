/**
 * Single source of truth for filesystem paths the dashboard touches at runtime.
 *
 * Why this file exists
 * --------------------
 * Two distinct directories were historically conflated by `~/`-anchored
 * `path.join` calls scattered across packages:
 *
 *   ~/.pi/dashboard/   — config + the *server* log (`server.log`)
 *   ~/.pi-dashboard/   — the *managed* install dir (npm packages, etc.)
 *                        Older bootstrap code also wrote an *installer*
 *                        log to `~/.pi-dashboard/server.log` (note: same
 *                        filename, different dir). That file is now
 *                        legacy/dead in the V2 launch path.
 *
 * Loading-page recovery surfaced this on 2026-05-17: the IPC handler
 * read `~/.pi-dashboard/server.log` (stale installer log from May 8)
 * while the live server wrote to `~/.pi/dashboard/server.log`.
 *
 * All path math lives here. Every $HOME override goes through `env.homedir`
 * so tests can re-root without mutating `os.homedir()`.
 *
 * See change: harvest-bootstrap-survivor-fixes (cherry-pick 1).
 */
import path from "node:path";
import os from "node:os";
import { getManagedDir as getManagedDirInternal, type ManagedPathsEnv } from "./managed-paths.js";

/** Shared env override surface — `homedir` only, mirrors `ManagedPathsEnv`. */
export type DashboardPathsEnv = ManagedPathsEnv;

/** `~/.pi/dashboard/` — config dir for `config.json`, `server.log`, etc. */
export function getDashboardConfigDir(env?: DashboardPathsEnv): string {
  return path.join(env?.homedir ?? os.homedir(), ".pi", "dashboard");
}

/** `~/.pi/dashboard/server.log` — the live dashboard server's stdout/stderr log. */
export function getDashboardServerLogPath(env?: DashboardPathsEnv): string {
  return path.join(getDashboardConfigDir(env), "server.log");
}

/**
 * `~/.pi/dashboard/first-run-done` — sentinel file written by the Electron
 * wizard on completion. Presence means the one-step welcome was shown and
 * acknowledged; subsequent launches skip the wizard.
 *
 * Lives under `~/.pi/dashboard/` (not the legacy `~/.pi-dashboard/`) so it
 * survives Electron whole-app updates and remains the same path across
 * all install layouts.
 *
 * See change: eliminate-electron-runtime-install (Q2 ratification).
 */
export function getFirstRunMarkerPath(env?: DashboardPathsEnv): string {
  return path.join(getDashboardConfigDir(env), "first-run-done");
}

/** `~/.pi-dashboard/` — managed-install root (npm packages, etc.). Re-export. */
export function getManagedDir(env?: DashboardPathsEnv): string {
  return getManagedDirInternal(env);
}

/**
 * `~/.pi-dashboard/server.log` — the legacy *installer* log. Distinct from
 * the server log; left here so callers can be explicit about which file
 * they want and the grep tooling has a single canonical reference.
 */
export function getInstallerLogPath(env?: DashboardPathsEnv): string {
  return path.join(getManagedDir(env), "server.log");
}

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

import os from "node:os";
import path from "node:path";
import { getManagedDir as getManagedDirInternal, type ManagedPathsEnv } from "./managed-paths.js";

/**
 * Shared env override surface. `homedir` mirrors `ManagedPathsEnv`; the
 * remaining fields are inputs to {@link resolvePiSessionsDir} only — the
 * other path getters ignore them.
 */
export type DashboardPathsEnv = ManagedPathsEnv & {
  /** `config.json#piSessionsDir` — operator's explicit dashboard override. */
  piSessionsDir?: string;
  /** Injected `process.env.PI_CODING_AGENT_SESSION_DIR` (test seam). */
  sessionDirEnv?: string;
  /** Injected `process.env.PI_CODING_AGENT_DIR` (test seam). */
  agentDirEnv?: string;
};

/** Expand a leading `~/` against `env.homedir` (or `os.homedir()`). */
function expandTilde(p: string, env?: DashboardPathsEnv): string {
  if (p === "~") return env?.homedir ?? os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(env?.homedir ?? os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Resolve the pi sessions root the dashboard scans. Precedence:
 *   1. `config.json#piSessionsDir`            (highest)
 *   2. `process.env.PI_CODING_AGENT_SESSION_DIR`
 *   3. `process.env.PI_CODING_AGENT_DIR` + `/sessions`
 *   4. literal `~/.pi/agent/sessions`         (last-ditch)
 * Each string layer is trimmed; whitespace-only is treated as unset and
 * falls through. Leading `~/` expands against `homedir`; absolute paths pass
 * through untouched.
 *
 * Layer 3 mirrors pi-core's `getSessionsDir()` (= `getAgentDir()/sessions`)
 * without importing the package: pi-core's published `.d.ts` barrel re-exports
 * via `./config.ts` specifiers that this project's `moduleResolution: bundler`
 * (no `allowImportingTsExtensions`) cannot value-import. Reading
 * `PI_CODING_AGENT_DIR` directly keeps `shared` dependency-light and tsc-clean.
 */
export function resolvePiSessionsDir(env?: DashboardPathsEnv): string {
  const pick = (s?: string): string | undefined => {
    const t = s?.trim();
    return t ? expandTilde(t, env) : undefined;
  };
  const agentDir = pick(env?.agentDirEnv ?? process.env.PI_CODING_AGENT_DIR);
  return (
    pick(env?.piSessionsDir) ??
    pick(env?.sessionDirEnv ?? process.env.PI_CODING_AGENT_SESSION_DIR) ??
    (agentDir ? path.join(agentDir, "sessions") : undefined) ??
    path.join(env?.homedir ?? os.homedir(), ".pi", "agent", "sessions")
  );
}

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

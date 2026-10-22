/**
 * Zombie-server adoption modal.
 *
 * Shown on the Electron `attach` arm when the discovered server is detected as
 * a leftover from a prior Electron lifetime (see `decideIsZombie`). Offers
 * three choices; the default (dismiss / Esc) is the safest "leave running".
 *
 * See change: electron-attach-ownership-fixes.
 */

import { attachedServerVersionSuggestion } from "@blackbelt-technology/pi-dashboard-shared/doctor-core.js";
import { dialog } from "electron";

export type ZombieChoice = "adopt" | "leave" | "stop";

/**
 * Present the adoption modal for a detected zombie server. Returns the user's
 * choice. Button order is fixed; `cancelId`/`defaultId` both point at
 * "Leave running" so Esc / window-close resolves to the zero-action path.
 */
export async function promptZombieAdoption(params: { pid: number }): Promise<ZombieChoice> {
  const buttons = ["Take ownership", "Leave running", "Stop now"];
  const leaveIndex = 1;
  const { response } = await dialog.showMessageBox({
    type: "question",
    title: "Leftover server from a previous run",
    message: "Leftover server from a previous run",
    detail:
      `A dashboard server (PID ${params.pid}) appears to have outlived a previous ` +
      `Electron session. Take ownership so quitting this app cleans it up?`,
    buttons,
    defaultId: leaveIndex,
    cancelId: leaveIndex,
    noLink: true,
  });
  if (response === 0) return "adopt";
  if (response === 2) return "stop";
  return "leave";
}

// ── Version-skew dialogs (See change: electron-attach-version-skew, D5) ─────

export type SkewRestartChoice = "restart" | "leave";
export type MergedZombieSkewChoice = "restart" | "adopt" | "leave";
export type SkewInfoChoice = "ok" | "dismiss";

const RESTART_WARNING =
  "Restarting stops the running server and drops live bridge connections; they reconnect to the new one.";

/** Skewed Electron-launched server: restart or leave. Default is Restart only when the owner is known dead. */
export async function promptVersionSkewRestart(params: {
  server: string;
  expected: string;
  restartIsDefault: boolean;
}): Promise<SkewRestartChoice> {
  const { response } = await dialog.showMessageBox({
    type: "question",
    title: "Dashboard server version differs",
    message: `The running dashboard server is v${params.server}; this app runs v${params.expected}.`,
    detail: `Restart the server with v${params.expected} so plugins and fixes match this app? ${RESTART_WARNING}`,
    buttons: [`Restart with v${params.expected}`, "Leave running"],
    defaultId: params.restartIsDefault ? 0 : 1,
    cancelId: 1,
    noLink: true,
  });
  return response === 0 ? "restart" : "leave";
}

/** A leftover (zombie) server that is also skewed: one modal instead of two. */
export async function promptMergedZombieSkew(params: {
  pid: number;
  server: string;
  expected: string;
}): Promise<MergedZombieSkewChoice> {
  const { response } = await dialog.showMessageBox({
    type: "question",
    title: "Leftover server from a previous run",
    message: `Leftover dashboard server v${params.server} (PID ${params.pid}); this app runs v${params.expected}.`,
    detail:
      `The server outlived a previous Electron session and runs a different version than this app. ` +
      `Restart it with v${params.expected}, or take ownership of it as-is. ${RESTART_WARNING}`,
    buttons: [`Restart with v${params.expected}`, "Take ownership", "Leave running"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (response === 0) return "restart";
  if (response === 1) return "adopt";
  return "leave";
}

/** Detail text of the informational modal; discloses when the fix installs the shell, not the expected, version. */
export function buildVersionSkewInfoDetail(params: {
  server: string;
  expected: string;
  shellVersion: string;
  launchSource: string | undefined;
}): string {
  const lines = [
    `The dashboard server on this machine was not started by this app, so it will not be stopped automatically.`,
    attachedServerVersionSuggestion(params.launchSource, params.shellVersion),
  ];
  if (params.expected !== params.shellVersion) {
    lines.push(
      `This fix installs v${params.shellVersion} (this app's version). The app currently runs the v${params.expected} runtime.`,
    );
  }
  return lines.join("\n\n");
}

/** Skewed server this app does not own: inform only. */
export async function promptVersionSkewInfo(params: {
  server: string;
  expected: string;
  shellVersion: string;
  launchSource: string | undefined;
}): Promise<SkewInfoChoice> {
  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "Dashboard server version differs",
    message: `The running dashboard server is v${params.server}; this app runs v${params.expected}.`,
    detail: buildVersionSkewInfoDetail(params),
    buttons: ["OK", "Don't show again for this version pair"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return response === 1 ? "dismiss" : "ok";
}

/** Plain outcome notice after a restart attempt (success, abort, or failure). */
export async function notifyRestartOutcome(params: { title: string; message: string; error?: boolean }): Promise<void> {
  await dialog.showMessageBox({
    type: params.error ? "warning" : "info",
    title: params.title,
    message: params.message,
    buttons: ["OK"],
    noLink: true,
  });
}

/**
 * Stop a zombie server by PID: SIGTERM, poll for `timeoutMs` for the process to
 * exit, then SIGKILL and poll `postKillMs` more. Returns `true` only once the
 * PID is CONFIRMED gone — `false` when it outlives SIGKILL + the post-kill
 * bound (the caller must then not spawn a replacement). Liveness is injected
 * (production: `isProcessAlive(pid, { epermAlive: true })`); time advances by
 * the injected `sleep` so tests are deterministic.
 *
 * See change: electron-attach-ownership-fixes, electron-attach-version-skew (D4b).
 */
export async function stopZombieServer(
  pid: number,
  deps: {
    kill: (pid: number, signal: NodeJS.Signals) => void;
    isAlive: (pid: number) => boolean;
    sleep: (ms: number) => Promise<void>;
    timeoutMs?: number;
    pollMs?: number;
    postKillMs?: number;
  },
): Promise<boolean> {
  const timeoutMs = deps.timeoutMs ?? 5000;
  const pollMs = deps.pollMs ?? 200;
  const postKillMs = deps.postKillMs ?? 2000;
  const waitGone = async (budgetMs: number): Promise<boolean> => {
    for (let waited = 0; waited < budgetMs; waited += pollMs) {
      await deps.sleep(pollMs);
      if (!deps.isAlive(pid)) return true;
    }
    return false;
  };
  try {
    deps.kill(pid, "SIGTERM");
  } catch {
    // ESRCH → already gone; EPERM → still alive, fall through to the poll.
    if (!deps.isAlive(pid)) return true;
  }
  if (await waitGone(timeoutMs)) return true;
  try {
    deps.kill(pid, "SIGKILL");
  } catch {
    /* gone, or EPERM: the poll below decides */
  }
  return waitGone(postKillMs);
}

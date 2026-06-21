/**
 * Preload script for Electron renderer (wizard window + loading page).
 * Exposes IPC APIs to the renderer via contextBridge.
 */
import { contextBridge, ipcRenderer } from "electron";
// Register the doctor bridge namespace on the same preload bundle.
// Side-effect import — `doctor-preload.ts` calls contextBridge.exposeInMainWorld.
// See change: doctor-rich-output.
import "./preload/doctor-preload.js";

/**
 * Slim wizard API under the immutable-bundle architecture.
 * Pre-R3 install / detection / installable-list / recommended-extensions
 * methods are removed (see change: eliminate-electron-runtime-install).
 */
export interface WizardApi {
  /** Mark first run complete and persist the marker file. */
  completeWizard: () => Promise<void>;
  /** Persist the chosen wizard mode (remote requires a verified URL). */
  persistMode: (mode: "standalone" | "power-user" | "remote", remoteUrl?: string) => Promise<void>;
  /** Open the Doctor diagnostic window. */
  openDoctor: () => void;
}

const api: WizardApi = {
  completeWizard: () => ipcRenderer.invoke("wizard:complete"),
  persistMode: (mode, remoteUrl) => ipcRenderer.invoke("wizard:persist-mode", { mode, remoteUrl }),
  openDoctor: () => ipcRenderer.send("wizard:open-doctor"),
};

contextBridge.exposeInMainWorld("wizardApi", api);

// ── piDashboard API ───────────────────────────────────────────────────────────────────
// User-initiated server-launch controls used by the loading page (and any
// future in-app retry control). See change: electron-server-launch-controls.
// Same preload is attached to both the loading page and the wizard window;
// each renderer uses only the namespace it needs.

export interface PiDashboardLaunchOutcome {
  kind: "already-running" | "started" | "failed";
  url?: string;
  reason?: string;
  logTail?: string;
}

export interface PiDashboardLaunchStatus {
  phase: "starting" | "shutting-down-existing" | "spawning" | "waiting-health" | "ready" | "failed";
  message?: string;
  url?: string;
}

export interface PiDashboardApi {
  requestLaunch: (force?: boolean) => Promise<PiDashboardLaunchOutcome>;
  openDoctor: () => void;
  readServerLog: (lines?: number) => Promise<string>;
  onStatus: (cb: (status: PiDashboardLaunchStatus) => void) => () => void;
}

const piDashboard: PiDashboardApi = {
  requestLaunch: (force) => ipcRenderer.invoke("dashboard:request-launch", { force: !!force }),
  openDoctor: () => ipcRenderer.send("dashboard:open-doctor"),
  readServerLog: (lines) => ipcRenderer.invoke("dashboard:read-server-log", { lines: lines ?? 20 }),
  onStatus: (cb) => {
    const listener = (_e: unknown, payload: PiDashboardLaunchStatus) => cb(payload);
    ipcRenderer.on("dashboard:launch-status", listener);
    return () => { ipcRenderer.removeListener("dashboard:launch-status", listener); };
  },
};

contextBridge.exposeInMainWorld("piDashboard", piDashboard);

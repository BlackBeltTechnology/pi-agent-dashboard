/**
 * Minimal preload for the MAIN window (loading page + dashboard, local or
 * remote). Exposes ONLY `window.piDashboard`; it deliberately does NOT import
 * the wizard bridges (`doctor-preload`, `remote-connect-preload`) because in
 * remote mode this window loads untrusted remote content. Privileged
 * `dashboard:*` handlers additionally validate `event.senderFrame`
 * (`lib/ipc-trust.ts`). See change: harden-electron-renderer-boundary (VD5).
 */
import { contextBridge, ipcRenderer } from "electron";

// ── piDashboard API ───────────────────────────────────────────────────────────────────
// User-initiated server-launch controls used by the loading page (and any
// future in-app retry control). See change: electron-server-launch-controls.
// Attached to the main window only (wizard windows use `preload.ts`).

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

export interface PiDashboardProbeResult {
  ok: boolean;
  version?: string;
  reason?: string;
}

export interface PiDashboardApi {
  requestLaunch: (force?: boolean) => Promise<PiDashboardLaunchOutcome>;
  openDoctor: () => void;
  readServerLog: (lines?: number) => Promise<string>;
  onStatus: (cb: (status: PiDashboardLaunchStatus) => void) => () => void;
  /**
   * Main-process reachability probe (Node fetch, no browser Origin, not CORS-
   * bound). Used by the loading page to decide when to navigate to a remote
   * dashboard whose CORS policy refuses the loading page's `null` origin.
   * See change: fix-remote-connect-cors-gates.
   */
  probeServer: (url: string) => Promise<PiDashboardProbeResult>;
  /**
   * Whole-app (electron-updater) check, from Settings → Dashboard runtime when
   * a runtime requires a newer app. See change: electron-runtime-overlay-updates.
   */
  checkAppUpdate: () => Promise<void>;
}

const piDashboard: PiDashboardApi = {
  requestLaunch: (force) => ipcRenderer.invoke("dashboard:request-launch", { force: !!force }),
  openDoctor: () => ipcRenderer.send("dashboard:open-doctor"),
  readServerLog: (lines) => ipcRenderer.invoke("dashboard:read-server-log", { lines: lines ?? 20 }),
  probeServer: (url) => ipcRenderer.invoke("dashboard:probe-server", { url }),
  checkAppUpdate: () => ipcRenderer.invoke("dashboard:check-app-update"),
  onStatus: (cb) => {
    const listener = (_e: unknown, payload: PiDashboardLaunchStatus) => cb(payload);
    ipcRenderer.on("dashboard:launch-status", listener);
    return () => { ipcRenderer.removeListener("dashboard:launch-status", listener); };
  },
};

contextBridge.exposeInMainWorld("piDashboard", piDashboard);

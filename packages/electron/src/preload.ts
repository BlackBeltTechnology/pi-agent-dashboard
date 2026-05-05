/**
 * Preload script for Electron renderer (wizard window).
 * Exposes IPC APIs to the renderer via contextBridge.
 */
import { contextBridge, ipcRenderer } from "electron";
// Register the doctor bridge namespace on the same preload bundle.
// Side-effect import — `doctor-preload.ts` calls contextBridge.exposeInMainWorld.
// See change: doctor-rich-output.
import "./preload/doctor-preload.js";

export interface WizardApi {
  /** Detect installed tools */
  detectDependencies: () => Promise<{
    pi: { found: boolean; source?: string };
    openspec: { found: boolean; source?: string };
    dashboard: { found: boolean; source?: string };
    node: { found: boolean; source?: string };
    apiKeyConfigured: boolean;
  }>;
  /** Run standalone install (optionally skip already-installed packages) */
  installStandalone: (skipPackages?: string[]) => Promise<void>;
  /** Install dashboard package globally (power user) */
  installDashboardGlobal: () => Promise<void>;
  /** Register the bundled bridge extension in pi's settings */
  registerBundledBridge: () => Promise<void>;
  /** Save API key */
  saveApiKey: (provider: string, key: string) => Promise<void>;
  /** Complete wizard and persist mode */
  completeWizard: (mode: "standalone" | "power-user") => Promise<void>;
  /** Listen for install progress events */
  onInstallProgress: (callback: (progress: { step: string; status: string; error?: string; output?: string }) => void) => void;
  /** Get the static recommended-extensions manifest + persisted skipped ids */
  getRecommendedExtensions: () => Promise<{
    recommended: Array<{
      id: string;
      source: string;
      displayName: string;
      fallbackDescription: string;
      status: "required" | "strongly-suggested" | "optional";
      unlocks: string[];
      toolsRegistered?: string[];
      autowired?: boolean;
    }>;
    skipped: string[];
  }>;
  /** Install the selected recommended extensions by id */
  installRecommendedExtensions: (ids: string[]) => Promise<{ installed: number }>;
  /** Persist the list of skipped recommended ids */
  persistRecommendedSkipped: (skippedIds: string[]) => Promise<void>;
  /** Open the Doctor diagnostic window. See change: doctor-rich-output (task 3.7). */
  openDoctor: () => void;

  // ── V2 API (behind LAUNCH_SOURCE_V2 flag) ───────────────────────────────
  // See change: simplify-electron-bootstrap-derived-state (tasks 7.1–7.3).

  /** Read installable.json; null when file is absent. */
  getInstallableList: () => Promise<import("@blackbelt-technology/pi-dashboard-shared/installable-list.js").InstallableList | null>;
  /** Save updated installable.json (used by package-selection sub-screen). */
  saveInstallableList: (list: import("@blackbelt-technology/pi-dashboard-shared/installable-list.js").InstallableList) => Promise<void>;
  /**
   * Fetch server bootstrap status (installable reconcile progress).
   * Returns null when server is not reachable.
   */
  getServerBootstrap: (serverUrl: string) => Promise<{
    status: string;
    installable?: { total: number; installed: number; failed: string[] };
    progress?: { step: string; output?: string };
  } | null>;
  /** Trigger a bootstrap retry on the running server. */
  retryBootstrap: (serverUrl: string) => Promise<boolean>;
}

const api: WizardApi = {
  detectDependencies: () => ipcRenderer.invoke("wizard:detect"),
  installStandalone: (skipPackages) => ipcRenderer.invoke("wizard:install-standalone", skipPackages),
  installDashboardGlobal: () => ipcRenderer.invoke("wizard:install-dashboard-global"),
  registerBundledBridge: () => ipcRenderer.invoke("wizard:register-bundled-bridge"),
  saveApiKey: (provider, key) => ipcRenderer.invoke("wizard:save-api-key", provider, key),
  completeWizard: (mode) => ipcRenderer.invoke("wizard:complete", mode),
  onInstallProgress: (callback) => {
    ipcRenderer.on("wizard:progress", (_event, progress) => callback(progress));
  },
  getRecommendedExtensions: () => ipcRenderer.invoke("wizard:get-recommended"),
  installRecommendedExtensions: (ids) => ipcRenderer.invoke("wizard:install-recommended", ids),
  persistRecommendedSkipped: (skippedIds) => ipcRenderer.invoke("wizard:persist-recommended-skipped", skippedIds),
  openDoctor: () => ipcRenderer.send("wizard:open-doctor"),

  // V2 API
  getInstallableList: () => ipcRenderer.invoke("wizard:v2:get-installable"),
  saveInstallableList: (list) => ipcRenderer.invoke("wizard:v2:save-installable", list),
  getServerBootstrap: (serverUrl) => ipcRenderer.invoke("wizard:v2:get-server-bootstrap", serverUrl),
  retryBootstrap: (serverUrl) => ipcRenderer.invoke("wizard:v2:retry-bootstrap", serverUrl),
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

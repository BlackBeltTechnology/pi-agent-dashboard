/**
 * Electron main process entry point.
 *
 * Six-state startup flow (see openspec/specs/electron-bootstrap-flow/spec.md
 * and change: eliminate-electron-runtime-install):
 *
 *   checking-server-health
 *     ├─→ attach            (a server is already running on the port)
 *     └─→ wizard-welcome    (first launch; marker absent)
 *           └─→ launch-server → health-wait → done
 *                                            └─→ loading-page-error (on timeout)
 *
 * On second+ launches the wizard-welcome state is skipped via the
 * `~/.pi/dashboard/first-run-done` marker.
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import { decideWillNavigate } from "./lib/link-handling.js";

const __filename = fileURLToPath(import.meta.url);

// Enable Wayland support on Linux (auto-detect X11 vs Wayland)
if (process.platform === "linux" && !process.env.ELECTRON_OZONE_PLATFORM_HINT) {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
}
import { mkdirSync, appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Startup log for debugging
const _LOG_DIR = process.env.TEMP || process.env.TMP || os.tmpdir();
const _LOG_PATH = path.join(_LOG_DIR, "pi-dashboard-electron.log");
function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    mkdirSync(_LOG_DIR, { recursive: true });
    appendFileSync(_LOG_PATH, line);
  } catch { /* ignore */ }
}
log("=== Electron starting ===");
log(`platform=${process.platform} arch=${process.arch} pid=${process.pid}`);
log(`resourcesPath=${(process as any).resourcesPath || "(none)"}`);
log(`execPath=${process.execPath}`);

// Disable GPU acceleration in VMs (prevents white screen on VMware/VirtualBox).
import { isVirtualMachine } from "@blackbelt-technology/pi-dashboard-shared/platform/commands.js";
import { getFirstRunMarkerPath } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

const isVM = isVirtualMachine();
const disableGpu = process.env.ELECTRON_DISABLE_GPU || isVM;
log(`VM detection: isVM=${isVM} disableGpu=${!!disableGpu}`);
if (disableGpu) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-software-rasterizer");
  log("GPU disabled");
}
log("Importing lib modules...");
import { registerWizardIpc, writeFirstRunMarker } from "./lib/wizard-ipc.js";
import {
  stopServerIfNeeded,
  loadMinimalConfig,
  setSpawnedPid,
  requestServerLaunch,
  isManagedServerRunning,
  readServerLogTail,
  onLaunchStatus,
  setGracefulShutdownInProgress,
  isGracefulShutdownInProgress,
  makeServerWatchdog,
} from "./lib/server-lifecycle.js";
import { showDoctorDialog } from "./lib/app-menu.js";
import { registerBundledBridgeExtension } from "./lib/bridge-register.js";
import { loadWindowState, saveWindowState } from "./lib/window-state.js";
import { createTray, destroyTray } from "./lib/tray.js";
import { startUpdateChecker } from "./lib/update-checker.js";
import { notifyUpdatesAvailable } from "./lib/update-notifier.js";
import { initAutoUpdater, quitAndInstall } from "./lib/app-updater.js";
import { setupAppMenu } from "./lib/app-menu.js";
import {
  selectLaunchSource,
  spawnFromSource,
  parsePreferOverride,
  PinnedSourceUnavailableError,
  BundledServerMissingError,
} from "./lib/launch-source.js";
import fs from "node:fs";
log("All imports loaded");

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let isStartingUp = true;

/** Show a splash screen immediately while the app boots. */
function showSplash(): void {
  splashWindow = new BrowserWindow({
    width: 320,
    height: 320,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    center: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  const html = `<html><head><style>
    html, body { overflow: hidden; }
    body { margin:0; display:flex; align-items:center; justify-content:center;
           height:100vh; background:transparent; -webkit-app-region:drag; }
    .card { background:#0d1117; border-radius:20px; padding:32px 36px;
            box-shadow:0 8px 32px rgba(0,0,0,0.5); text-align:center;
            min-width: 200px; max-width: 240px; box-sizing: border-box; }
    .pi { font-size:80px; color:#4a90d9; margin-bottom:8px; font-weight:bold;
          font-family:-apple-system,BlinkMacSystemFont,sans-serif; }
    .label { font-size:14px; color:#c9d1d9; margin-bottom:16px;
             font-family:-apple-system,BlinkMacSystemFont,sans-serif; }
    .spinner { margin: 12px auto; border: 2px solid #30363d;
               border-top-color: #4a90d9; border-radius: 50%;
               width: 18px; height: 18px; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .status { font-size:12px; color:#8b949e; height:16px;
              font-family:-apple-system,BlinkMacSystemFont,sans-serif;
              transition: opacity 0.2s; }
  </style></head><body><div class="card">
    <div class="pi">π</div>
    <div class="label">pi-agent-dashboard</div>
    <div class="spinner"></div>
    <div class="status" id="status">Starting…</div>
  </div></body></html>`;
  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  splashWindow.on("closed", () => { splashWindow = null; });
}

/** Update the splash screen status line. No-op if splash is not visible. */
function updateSplashStatus(text: string): void {
  log(`splash: ${text}`);
  if (!splashWindow || splashWindow.isDestroyed()) return;
  const safe = text.replace(/`/g, "\\`").replace(/\$/g, "\\$");
  splashWindow.webContents
    .executeJavaScript(
      `(() => { const el = document.getElementById("status"); if (el) el.textContent = \`${safe}\`; })()`,
    )
    .catch(() => { /* splash may be closing */ });
}

/** Close the splash screen. */
function closeSplash(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

/**
 * Resolve the path to the preload script attached to the main window.
 */
function getMainPreloadPath(): string {
  const dir = path.dirname(__filename);
  const sameDir = path.join(dir, "preload.js");
  if (fs.existsSync(sameDir)) return sameDir;
  const forgeDev = path.join(process.cwd(), ".vite", "build", "preload.js");
  if (fs.existsSync(forgeDev)) return forgeDev;
  return sameDir;
}

/**
 * Register IPC handlers used by the loading-page preload (`piDashboard`).
 * Idempotent — calling twice (e.g. across reload cycles) replaces handlers.
 */
function registerPiDashboardIpc(): void {
  ipcMain.removeHandler("dashboard:request-launch");
  ipcMain.handle("dashboard:request-launch", async (_event, payload: { force?: boolean } = {}) => {
    return requestServerLaunch({ force: !!payload?.force });
  });

  ipcMain.removeHandler("dashboard:read-server-log");
  ipcMain.handle("dashboard:read-server-log", async (_event, payload: { lines?: number } = {}) => {
    return readServerLogTail(payload?.lines ?? 20);
  });

  ipcMain.removeAllListeners("dashboard:open-doctor");
  ipcMain.on("dashboard:open-doctor", () => { void showDoctorDialog(); });

  ipcMain.removeAllListeners("wizard:open-doctor");
  ipcMain.on("wizard:open-doctor", () => { void showDoctorDialog(); });
}

/**
 * Forward `LaunchStatus` events to the main window's renderer (loading page).
 */
function wireLaunchStatusForwarder(): () => void {
  return onLaunchStatus((status) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try { mainWindow.webContents.send("dashboard:launch-status", status); }
    catch { /* renderer may have navigated away */ }
  });
}

/** Resolve path to the loading-page HTML resource. */
function resolveLoadingPagePath(): string {
  const dir = path.dirname(__filename);
  const dev = path.resolve(dir, "..", "..", "resources", "loading.html");
  if (fs.existsSync(dev)) return dev;
  if ((process as any).resourcesPath) {
    const packaged = path.join((process as any).resourcesPath, "loading.html");
    if (fs.existsSync(packaged)) return packaged;
  }
  return dev;
}

/** Show a loading page that retries connecting to the server. */
function showLoadingPage(win: BrowserWindow, serverUrl: string): void {
  const config = loadMinimalConfig();
  const knownServersBase64 = Buffer.from(JSON.stringify(config.knownServers)).toString("base64");
  const loadingHtml = resolveLoadingPagePath();
  const query: Record<string, string> = { serverUrl };
  if (config.knownServers.length > 0) query.knownServers = knownServersBase64;
  win.loadFile(loadingHtml, { query }).catch((err: any) => {
    log(`loadFile(loading.html) failed: ${err?.message || err}`);
  });
}

let isQuitting = false;
let cleanupUpdateChecker: (() => void) | null = null;
let cleanupAutoUpdater: (() => void) | null = null;

function createMainWindow(serverUrl: string): BrowserWindow {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    title: "PI Dashboard",
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: getMainPreloadPath(),
    },
  });

  if (state.isMaximized) mainWindow.maximize();

  // External-link hardening (issue #13, change: harden-external-link-handling).
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL() ?? "";
    const decision = decideWillNavigate(serverUrl, currentUrl, url);
    if (decision === "open-external") {
      event.preventDefault();
      void shell.openExternal(url);
    } else if (decision === "cancel") {
      event.preventDefault();
    }
  });

  mainWindow.loadURL(serverUrl);

  mainWindow.on("resize", () => mainWindow && saveWindowState(mainWindow));
  mainWindow.on("move", () => mainWindow && saveWindowState(mainWindow));

  // macOS: minimize to tray on close (standard macOS behavior)
  mainWindow.on("close", (event) => {
    if (!isQuitting && process.platform === "darwin") {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

function startUpdaters(): void {
  cleanupUpdateChecker = startUpdateChecker(notifyUpdatesAvailable);
  cleanupAutoUpdater = initAutoUpdater({
    onUpdateAvailable: (version) => {
      dialog.showMessageBox({
        type: "info",
        title: "Update Available",
        message: `PI Dashboard v${version} is available.`,
        buttons: ["Download & Restart", "Later"],
        defaultId: 0,
      }).then(({ response }) => {
        if (response === 0) quitAndInstall();
      });
    },
    onUpdateDownloaded: (version) => {
      dialog.showMessageBox({
        type: "info",
        title: "Update Ready",
        message: `PI Dashboard v${version} has been downloaded. Restart to apply.`,
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
      }).then(({ response }) => {
        if (response === 0) quitAndInstall();
      });
    },
    onError: () => { /* silently ignore update errors */ },
  });
}

async function quit(): Promise<void> {
  isQuitting = true;
  setGracefulShutdownInProgress(true);
  cleanupUpdateChecker?.();
  cleanupAutoUpdater?.();
  await stopServerIfNeeded();
  destroyTray();
  app.quit();
}

/**
 * True when the first-run-done marker is absent (i.e. this is the first
 * launch of the .app on this machine).
 */
function isFirstRun(): boolean {
  return !existsSync(getFirstRunMarkerPath());
}

/**
 * Show the one-step welcome window. Opens the slim wizard.html (single
 * step: welcome message + [Launch dashboard] CTA + Advanced disclosure
 * with remote-connect probe). Resolves when the user closes the wizard
 * window (either by clicking [Launch dashboard] which calls
 * `wizard:complete` then `window.close()`, or by closing manually).
 *
 * `writeFirstRunMarker` is called inside the wizard renderer via the
 * preload `wizard:complete` IPC. As a defensive fallback, we also write
 * the marker here if it's still absent after the window closes — this
 * keeps subsequent launches stable even if the user dismisses the
 * window via the OS chrome.
 */
async function showWelcomeStep(): Promise<void> {
  log("wizard-welcome: opening welcome window");
  try {
    const { openWizardWindow } = await import("./lib/wizard-window.js");
    await openWizardWindow();
  } catch (err: any) {
    log(`wizard-welcome: failed to open wizard window: ${err?.message || err}`);
  }
  // Defensive: ensure the marker is written even if the renderer never
  // called wizard:complete (e.g. user closed via OS chrome).
  try {
    if (!existsSync(getFirstRunMarkerPath())) writeFirstRunMarker();
  } catch (err: any) {
    log(`wizard-welcome: marker write fallback failed: ${err?.message || err}`);
  }
}

async function main(): Promise<void> {
  // Single-instance lock
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  await app.whenReady();

  showSplash();

  app.name = "PI Dashboard";
  setupAppMenu();

  // Register slim wizard IPC (currently only wizard:complete + open-doctor).
  registerWizardIpc(() => null);

  // Register loading-page IPC (Start server / Open Doctor / Server log).
  registerPiDashboardIpc();
  wireLaunchStatusForwarder();

  const config = loadMinimalConfig();

  try {
    // ── State: checking-server-health ────────────────────────────────────────
    updateSplashStatus("Checking dashboard server…");
    const source = await selectLaunchSource({
      isPackaged: app.isPackaged,
      cwd: process.cwd(),
      preferOverride: parsePreferOverride(process.env),
      resourcesPath: (process as any).resourcesPath ?? "",
      port: config.port,
    });
    log(`[launch-source] resolved kind=${source.kind}`);

    if (source.kind === "attach") {
      // ── State: attach ───────────────────────────────────────────────────
      updateSplashStatus("Opening dashboard…");
      const win = createMainWindow(source.url);
      closeSplash();
      showLoadingPage(win, source.url);
      createTray(() => mainWindow, quit, {
        getServerStatus: isManagedServerRunning,
        onLaunch: (force) => { void requestServerLaunch({ force }); },
      });
      startUpdaters();
      isStartingUp = false;
      return;
    }

    // ── State: wizard-welcome (first launch only) ────────────────────────────
    if (isFirstRun()) {
      // Best-effort bundled bridge registration; non-fatal.
      try { registerBundledBridgeExtension(); } catch { /* non-fatal */ }
      // Close splash BEFORE opening the wizard. The splash is alwaysOnTop;
      // leaving it visible occludes the wizard on Windows (no [Launch dashboard]
      // CTA reachable) and freezes the startup machine waiting for the wizard's
      // 'closed' event that can never fire. See change: fix-wizard-occluded-by-splash.
      closeSplash();
      await showWelcomeStep();
      // Re-open splash for subsequent status updates between wizard-close and
      // main-window-open. Without this, updateSplashStatus calls below are
      // silent no-ops and the user sees no progress feedback.
      showSplash();
    }

    // ── State: launch-server ─────────────────────────────────────────────────
    updateSplashStatus("Launching dashboard server…");
    const logFile = path.join(os.homedir(), ".pi", "dashboard", "server.log");
    const spawnResult = await spawnFromSource(
      source as Exclude<typeof source, { kind: "attach" }>,
      { port: config.port, piPort: config.piPort },
      {
        logFile,
        onChildExit: makeServerWatchdog({
          isGraceful: isGracefulShutdownInProgress,
          log,
          onCrash: () => {
            const win = mainWindow;
            if (win && !win.isDestroyed()) {
              showLoadingPage(win, `http://localhost:${config.port}`);
            }
          },
        }),
      },
    );
    log(`[launch-source] spawned server pid=${spawnResult.pid}`);
    setSpawnedPid(spawnResult.pid);

    // ── State: health-wait → done ────────────────────────────────────────────
    // (`launchDashboardServer` inside `spawnFromSource` already waits for the
    // readiness signal; reaching here means health-wait completed.)
    updateSplashStatus("Opening dashboard…");
    const serverUrl = `http://localhost:${config.port}`;
    const win = createMainWindow(serverUrl);
    closeSplash();
    showLoadingPage(win, serverUrl);
    createTray(() => mainWindow, quit, {
      getServerStatus: isManagedServerRunning,
      onLaunch: (force) => { void requestServerLaunch({ force }); },
    });
    startUpdaters();

    // Confirm first-run marker is on disk now that we reached `done`.
    try {
      const markerPath = getFirstRunMarkerPath();
      if (!existsSync(markerPath)) {
        mkdirSync(path.dirname(markerPath), { recursive: true });
        writeFileSync(markerPath, new Date().toISOString() + "\n");
      }
    } catch { /* non-fatal */ }

    isStartingUp = false;
    return;
  } catch (err: any) {
    // ── State: loading-page-error ────────────────────────────────────────────
    if (err instanceof PinnedSourceUnavailableError) {
      closeSplash();
      await dialog.showMessageBox({
        type: "error",
        title: "PI Dashboard — Launch Source Unavailable",
        message: err.message,
        detail: "Remove the DASHBOARD_PREFER_SOURCE override or fix the pinned source.",
      });
      app.quit();
      return;
    }
    if (err instanceof BundledServerMissingError) {
      closeSplash();
      await dialog.showMessageBox({
        type: "error",
        title: "PI Dashboard — Bundled Server Missing",
        message: err.message,
        detail: "Reinstall the application from the official installer.",
      });
      app.quit();
      return;
    }

    log(`startup failed: ${err?.message || err}`);
    const serverUrl = `http://localhost:${config.port}`;
    const win = createMainWindow(serverUrl);
    closeSplash();
    showLoadingPage(win, serverUrl);
    createTray(() => mainWindow, quit, {
      getServerStatus: isManagedServerRunning,
      onLaunch: (force) => { void requestServerLaunch({ force }); },
    });
    startUpdaters();
    isStartingUp = false;
  }
}

// macOS: re-create window when dock icon clicked
app.on("activate", () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// Linux/Windows: quit when all windows are closed (but not during startup/wizard)
// macOS: keep running (hide to tray)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && mainWindow === null && !isStartingUp) {
    quit();
  }
});

main().catch(async (err) => {
  log(`FATAL: ${err?.message || err}`);
  closeSplash();
  console.error("Failed to start:", err);
  try {
    await dialog.showMessageBox({
      type: "error",
      title: "PI Dashboard",
      message: "Unexpected error during startup",
      detail: String(err?.message || err),
    });
  } catch { /* dialog failed too */ }
  app.quit();
});

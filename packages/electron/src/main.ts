/**
 * Electron main process entry point.
 *
 * Five-state startup flow (see openspec/specs/electron-bootstrap-flow/spec.md
 * and change: auto-launch-first-run-skip-welcome):
 *
 *   checking-server-health
 *     ├─→ attach            (a server is already running on the port)
 *     └─→ launch-server → health-wait → done
 *                                        └─→ loading-page-error (on timeout)
 *
 * There is no first-run wizard: launch is unconditional. The
 * `~/.pi/dashboard/first-run-done` marker is still written on the first
 * `done` for backwards compatibility (Doctor / support tooling read it).
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import { decideWillNavigate } from "./lib/link-handling.js";
import { resolveCdpActivation } from "./lib/resolve-cdp-activation.js";

const __filename = fileURLToPath(import.meta.url);

// Opt-in CDP debug surface (see change: ship-browser-skill-and-electron-cdp).
// Must run BEFORE app.requestSingleInstanceLock() and BEFORE app.whenReady()
// because Chromium reads `remote-debugging-port` during browser-process init.
// Never appends the address-binding switch — Chromium's loopback default
// (127.0.0.1) is what we want; promiscuous binding would be a remote RCE.
const _cdp = resolveCdpActivation(process.argv, process.env);
if (_cdp.enabled && _cdp.port !== undefined) {
  app.commandLine.appendSwitch("remote-debugging-port", String(_cdp.port));
  // Single-line warning on stderr so the activation is visible.
  // eslint-disable-next-line no-console
  console.error(`[debug-cdp] CDP listening on :${_cdp.port} \u2014 local automation is enabled`);
}

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
// Global unhandled-rejection reporter for the main process — the regression
// guard for the promise-handling cleanup. Installed before any application
// work so an escaped rejection reaches `log()` instead of being silent.
//
// It reports every reason in full and never replaces it with a placeholder.
// Note the one real semantic effect of REGISTERING a listener at all: Node's
// default `--unhandled-rejections=throw` no longer terminates the main
// process. That is deliberate for a desktop shell — a stray rejection should
// leave a log line, not kill the user's app mid-session — and it mirrors
// `packages/server/src/cli.ts`, which already does this for the server process.
// See change: cleanup-client-plugin-promises (design D2).
process.on("unhandledRejection", (reason) => {
  const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  log(`[unhandledRejection] ${detail}`);
});

log("=== Electron starting ===");
log(`platform=${process.platform} arch=${process.arch} pid=${process.pid}`);
log(`resourcesPath=${(process as any).resourcesPath || "(none)"}`);
log(`execPath=${process.execPath}`);

// Disable GPU acceleration in VMs (prevents white screen on VMware/VirtualBox).
import { isVirtualMachine } from "@blackbelt-technology/pi-dashboard-shared/platform/commands.js";
import { loadWithLocalProof } from "./lib/local-proof-bootstrap.js";
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
import { readModeFile } from "./lib/wizard-state.js";
import { normalizeRemoteUrl, probeRemote } from "./lib/remote-probe.js";
import {
  stopServerIfNeeded,
  loadMinimalConfig,
  setSpawnedPid,
  requestServerLaunch,
  readServerLogTail,
  onLaunchStatus,
  setGracefulShutdownInProgress,
  isGracefulShutdownInProgress,
  makeServerWatchdog,
  decideOwnership,
  decideIsZombie,
  getStoredSpawnedPid,
  setLocalServerSpawner,
} from "./lib/server-lifecycle.js";
import { promptZombieAdoption, stopZombieServer } from "./lib/zombie-adoption-dialog.js";
import { isDashboardRunning } from "./lib/health-check.js";
import { showDoctorDialog } from "./lib/app-menu.js";
import { registerBundledBridgeExtension } from "./lib/bridge-register.js";
import { loadWindowState, saveWindowState } from "./lib/window-state.js";
import { createTray, destroyTray, type TrayOwnership } from "./lib/tray.js";
import { startUpdateChecker } from "./lib/update-checker.js";
import { notifyUpdatesAvailable } from "./lib/update-notifier.js";
import { initAutoUpdater, downloadAndInstall, quitAndInstall } from "./lib/app-updater.js";
import { installQuitGuard } from "./lib/quit-guard.js";
import { handleCheckForUpdates, setupAppMenu } from "./lib/app-menu.js";
import {
  parsePreferOverride,
  PinnedSourceUnavailableError,
  BundledServerMissingError,
} from "./lib/launch-source.js";
import type { SwitchResult } from "./lib/runtime-overlay.js";
import {
  resolveAndSpawnRuntime,
  startActivationWatcher,
  type RuntimeSwitchContext,
} from "./lib/runtime-overlay-main.js";
import fs from "node:fs";
log("All imports loaded");

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let isStartingUp = true;

// ── Runtime overlay activation (server → Electron) ────────────────────────────
// The server writes request.json#activateNonce; Electron polls it (2 s) and
// runs switchRuntime. A rollback is surfaced non-blockingly.
// See change: electron-runtime-overlay-updates (D3).

function notifyRuntimeSwitch(result: SwitchResult): void {
  log(`[runtime-overlay] switch result ${JSON.stringify(result)}`);
  if (result.kind === "committed") return;
  const detail =
    result.kind === "rolledBack"
      ? `Runtime ${result.failedId} failed (${result.reason}). Running ${result.runtimeId} instead.`
      : result.kind === "aborted"
        ? `Runtime switch aborted: ${result.reason}${result.detail ? ` (${result.detail})` : ""}.`
        : `Runtime switch failed: ${result.reason}.`;
  dialog
    .showMessageBox({ type: "warning", title: "Dashboard runtime", message: "Runtime was not switched", detail, buttons: ["OK"] })
    .catch((err: unknown) => log(`[runtime-overlay] notice dialog failed: ${String(err)}`));
  const win = mainWindow;
  if (win && !win.isDestroyed()) win.webContents.reload();
}

// `ensureServer` (loading-page "Start server", tray) spawns through the same
// runtime-overlay-aware resolver as startup. No watchdog on that path (as before).
setLocalServerSpawner(async (o) => {
  const launched = await resolveAndSpawnRuntime({
    resolver: { isPackaged: o.isPackaged, cwd: o.cwd, preferOverride: o.preferOverride, resourcesPath: o.resourcesPath, port: o.port },
    port: o.port,
    piPort: o.piPort,
    logFile: o.logFile,
    shellVersion: app.getVersion(),
    log,
    registerBundledExtension: registerBundledBridgeExtension,
    onChildExit: (code, signal, pid) => serverExitWatchdog(pid)(code, signal),
  });
  return launched.kind === "attach" ? { kind: "attach", url: launched.source.url } : { kind: "spawned", pid: launched.pid };
});

/** Server exited unexpectedly → the loading/recovery page (it retries the connection). */
function showServerRecovery(): void {
  const win = mainWindow;
  if (win && !win.isDestroyed()) showLoadingPage(win, `http://localhost:${loadMinimalConfig().port}`);
}

/**
 * `/api/restart` on our server exits with ELECTRON_RESTART_EXIT_CODE; respawn it
 * through the app's own runtime path so it keeps the Electron starter, runtime
 * identity and this watchdog. See change: electron-runtime-overlay-updates.
 */
function restartOwnedServer(): void {
  requestServerLaunch({ force: false })
    .then((outcome) => {
      log(`[server-lifecycle] restart outcome=${outcome.kind}`);
      if (outcome.kind === "failed") showServerRecovery();
    })
    .catch((err: unknown) => {
      log(`[server-lifecycle] restart failed: ${err instanceof Error ? err.message : String(err)}`);
      showServerRecovery();
    });
}

/** One watchdog per spawned server pid: crash → recovery page, restart request → respawn. */
function serverExitWatchdog(pid: number | undefined) {
  return makeServerWatchdog({
    isGraceful: isGracefulShutdownInProgress,
    log,
    onCrash: showServerRecovery,
    onRestartRequested: restartOwnedServer,
    getPid: () => pid,
  });
}

function startRuntimeActivationWatcher(ctx: RuntimeSwitchContext): void {
  startActivationWatcher(ctx, notifyRuntimeSwitch);
}

// Zombie-adoption modal: in-memory "already asked this launch" guard so a
// user who picks "Leave running" is not re-prompted by any later re-evaluation
// this process lifetime. Reset only on the next Electron launch.
// See change: electron-attach-ownership-fixes.
let zombieAskedThisSession = false;

/**
 * Ownership probe for the tray. GET /api/health with a 1 s timeout; classifies
 * via `decideOwnership`. Returns "unknown" on fetch error or non-200 so the
 * tray omits the launch item rather than showing a misleading one.
 * See change: electron-attach-ownership-fixes.
 */
async function getServerOwnership(): Promise<TrayOwnership> {
  const config = loadMinimalConfig();
  try {
    const res = await fetch(`http://localhost:${config.port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return "unknown";
    const body = await res.json() as Record<string, unknown>;
    return decideOwnership({
      healthLaunchSource:
        typeof body.launchSourceEffective === "string"
          ? (body.launchSourceEffective as any)
          : null,
      healthPid: typeof body.pid === "number" ? body.pid : undefined,
      storedSpawnedPid: getStoredSpawnedPid(),
    });
  } catch {
    return "unknown";
  }
}

/**
 * On the attach arm: detect a leftover server from a prior Electron lifetime
 * and offer adoption. Suppressed under --no-zombie-prompt (detection still
 * runs for logging). See change: electron-attach-ownership-fixes.
 */
async function maybePromptZombieAdoption(): Promise<void> {
  if (zombieAskedThisSession) return;
  const config = loadMinimalConfig();
  let body: Record<string, unknown>;
  try {
    const res = await fetch(`http://localhost:${config.port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return;
    body = await res.json() as Record<string, unknown>;
  } catch {
    return;
  }
  const healthPid = typeof body.pid === "number" ? body.pid : undefined;
  const isZombie = decideIsZombie({
    healthLaunchSourceEffective:
      typeof body.launchSourceEffective === "string" ? (body.launchSourceEffective as any) : null,
    healthPid,
    healthPpid: typeof body.ppid === "number" ? body.ppid : undefined,
    healthBootParentPid: typeof body.bootParentPid === "number" ? body.bootParentPid : undefined,
    healthBootParentAlive: typeof body.bootParentAlive === "boolean" ? body.bootParentAlive : undefined,
    storedSpawnedPid: getStoredSpawnedPid(),
    platform: process.platform,
  });
  if (!isZombie || healthPid === undefined) return;
  log(`[zombie] detected leftover server PID ${healthPid}`);

  if (app.commandLine.hasSwitch("no-zombie-prompt")) {
    log("[zombie] --no-zombie-prompt set; skipping modal");
    return;
  }

  const choice = await promptZombieAdoption({ pid: healthPid });
  if (choice === "adopt") {
    setSpawnedPid(healthPid);
    log(`[zombie] adopted PID ${healthPid}`);
    return;
  }
  if (choice === "leave") {
    zombieAskedThisSession = true;
    log("[zombie] left running, will prompt next launch");
    return;
  }
  // "stop": SIGTERM → SIGKILL, then respawn a fresh server + reload the window
  // (which was pointed at the now-killed server's URL).
  log(`[zombie] stopping PID ${healthPid} and respawning`);
  await stopZombieServer(healthPid, {
    // Signal a specific pid (not a group) — the injected fn drives the
    // stopZombieServer SIGTERM→poll→SIGKILL ladder.
    kill: (pid, signal) => process.kill(pid, signal), // ban:process-kill-ok
    isRunning: async () => (await isDashboardRunning(config.port)).running,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  try {
    // Runtime-overlay aware: respawn the current runtime, not always the bundle.
    // See change: electron-runtime-overlay-updates.
    const launched = await resolveAndSpawnRuntime({
      resolver: {
        isPackaged: app.isPackaged,
        cwd: process.cwd(),
        preferOverride: parsePreferOverride(process.env),
        resourcesPath: (process as { resourcesPath?: string }).resourcesPath ?? "",
        port: config.port,
      },
      port: config.port,
      piPort: config.piPort,
      logFile: path.join(os.homedir(), ".pi", "dashboard", "server.log"),
      shellVersion: app.getVersion(),
      log,
      registerBundledExtension: registerBundledBridgeExtension,
      onChildExit: (code, signal, pid) => serverExitWatchdog(pid)(code, signal),
    });
    if (launched.kind === "spawned") {
      setSpawnedPid(launched.pid);
      log(`[zombie] respawned server pid=${launched.pid}`);
    }
    // Reload the window only after the fresh server passes a health probe.
    // Gate on an explicit success flag: a bare deadline break would reload the
    // window against a not-yet-ready server, reproducing the connection-refused
    // page this path exists to avoid.
    const deadline = Date.now() + 15_000;
    let healthy = false;
    while (Date.now() < deadline) {
      if ((await isDashboardRunning(config.port)).running) { healthy = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (healthy && mainWindow && !mainWindow.isDestroyed()) {
      loadWithLocalProof(mainWindow, `http://localhost:${config.port}`).catch((e) => log(`[zombie] loadURL failed: ${e?.message || e}`));
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      log("[zombie] respawned server did not become healthy within 15s; leaving current page");
    }
  } catch (err: any) {
    log(`[zombie] respawn failed: ${err?.message || err}`);
  }
}

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

  // Settings → Dashboard runtime "Check for app update" (requires_app refusal).
  // No renderer input. See change: electron-runtime-overlay-updates.
  ipcMain.removeHandler("dashboard:check-app-update");
  ipcMain.handle("dashboard:check-app-update", () => handleCheckForUpdates());

  ipcMain.removeHandler("dashboard:probe-server");
  ipcMain.handle("dashboard:probe-server", async (_event, payload: { url?: unknown } = {}) => {
    // Untrusted renderer input — normalize before use. Node fetch sends no
    // Origin header, so this is not subject to the remote's CORS policy.
    const url = normalizeRemoteUrl(payload?.url);
    if (!url) return { ok: false, reason: "Invalid URL" };
    return probeRemote(url);
  });

  ipcMain.removeAllListeners("dashboard:open-doctor");
  ipcMain.on("dashboard:open-doctor", () => { void showDoctorDialog(); });
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

  // Bootstrap local proof (cookie) before the dashboard loads: required for pairing
  // approval in every mode and for `requireLocalProof`. Falls back to the plain URL.
  // See change: harden-trust-and-credential-boundaries (D2/D6).
  loadWithLocalProof(mainWindow, serverUrl).catch((e) => log(`loadURL failed: ${e?.message || e}`));

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
        buttons: ["Download", "Later"],
        defaultId: 0,
      }).then(({ response }) => {
        // autoDownload is disabled; consent triggers the download. The
        // update-downloaded handler below applies it via quitAndInstall().
        if (response === 0) downloadAndInstall();
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
        if (response === 0) {
          // Let quitAndInstall's app.quit() through the quit guard + close handler.
          isQuitting = true;
          quitAndInstall();
        }
      });
    },
    // Errors are logged with a severity tier inside app-updater's error
    // listener (electron-main.log); no user-facing dialog for background checks.
    onError: () => {},
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
 * Sync entrypoint for `quit`, for the callers that cannot await it: `createTray`
 * declares `onQuit: () => void` and Electron's `app.on(...)` listeners are sync.
 * Defined once and passed at every site rather than hand-rolled per call.
 *
 * `quit` cannot be made sync (it awaits `stopServerIfNeeded`), and bare
 * `void quit()` is banned, so the rejection gets a named owner here. The
 * fallback `app.quit()` is load-bearing: a rejecting `stopServerIfNeeded` skips
 * the `destroyTray()`/`app.quit()` tail of `quit`, which would strand the app
 * running with no way to exit.
 * See change: cleanup-async-semantics-server-extension (design D1, D4).
 */
function requestQuit(): void {
  void quit().catch((err: unknown) => {
    log(`quit failed: ${err instanceof Error ? err.message : String(err)}`);
    app.quit();
  });
}

// App menu Quit / Cmd+Q / Dock Quit → the full quit (stop server, tray, exit),
// not just a hidden window. See lib/quit-guard.ts.
installQuitGuard(app, { isQuitting: () => isQuitting, requestQuit });

async function main(): Promise<void> {
  // Single-instance lock
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on("second-instance", (_event, argv) => {
    // If a second launch passes --debug-cdp but the first instance was started
    // without it, CDP cannot be enabled retroactively (Chromium stands up the
    // CDP server during browser-process init; no API to enable later).
    // Surface the constraint as a one-line warning on the first instance's stderr.
    // See change: ship-browser-skill-and-electron-cdp.
    if (!_cdp.enabled && argv.some((a) => a === "--debug-cdp" || a.startsWith("--debug-cdp="))) {
      // eslint-disable-next-line no-console
      console.error(
        "[debug-cdp] cannot enable CDP retroactively \u2014 fully quit the app and relaunch with --debug-cdp",
      );
    }
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

  // Register loading-page IPC (Start server / Open Doctor / Server log).
  registerPiDashboardIpc();
  wireLaunchStatusForwarder();

  const config = loadMinimalConfig();

  try {
    // ── State: remote-mode attach (docker-packaging) ─────────────────────────
    // If the wizard persisted remote mode, attach to the configured URL
    // directly — skip local discovery, health probing, and spawning. The
    // shell never started the server, so quit leaves it running.
    const modeConfig = readModeFile();
    if (modeConfig?.mode === "remote" && modeConfig.remoteUrl) {
      const remoteUrl = modeConfig.remoteUrl;
      log(`[launch-source] remote mode → attach ${remoteUrl}`);
      updateSplashStatus("Opening remote dashboard…");
      const win = createMainWindow(remoteUrl);
      closeSplash();
      showLoadingPage(win, remoteUrl);
      createTray(() => mainWindow, requestQuit, {
        getServerOwnership,
        onLaunch: (force) => { void requestServerLaunch({ force }); },
      });
      startUpdaters();
      isStartingUp = false;
      return;
    }

    // ── State: checking-server-health → launch-server ───────────────────────
    // One resolver pass covers attach, devMonorepo, a linked local checkout,
    // a staged runtime overlay and the bundle (last fallback), with the
    // runtime-overlay retry-once / rollback bookkeeping.
    // See change: electron-runtime-overlay-updates (D3, D4).
    updateSplashStatus("Checking dashboard server…");
    const logFile = path.join(os.homedir(), ".pi", "dashboard", "server.log");
    const onCrash = (): void => {
      const win = mainWindow;
      if (win && !win.isDestroyed()) {
        showLoadingPage(win, `http://localhost:${config.port}`);
      }
    };
    const launched = await resolveAndSpawnRuntime({
      resolver: {
        isPackaged: app.isPackaged,
        cwd: process.cwd(),
        preferOverride: parsePreferOverride(process.env),
        resourcesPath: (process as { resourcesPath?: string }).resourcesPath ?? "",
        port: config.port,
      },
      port: config.port,
      piPort: config.piPort,
      logFile,
      shellVersion: app.getVersion(),
      log,
      // Best-effort bundled bridge registration; non-fatal.
      // See change: auto-launch-first-run-skip-welcome (task 1.1a).
      registerBundledExtension: registerBundledBridgeExtension,
      // PID-aware so a runtime switch's planned stop of THIS server
      // (expectExit) is graceful, while any other exit still reaches recovery.
      onChildExit: (code, signal, pid) =>
        serverExitWatchdog(pid)(code, signal),
    });
    log(`[launch-source] resolved kind=${launched.source.kind}`);
    const runtimeCtx: RuntimeSwitchContext = {
      port: config.port,
      piPort: config.piPort,
      logFile,
      resourcesPath: (process as { resourcesPath?: string }).resourcesPath ?? "",
      shellVersion: app.getVersion(),
      log,
      onCrash,
      onRestartRequested: restartOwnedServer,
    };

    if (launched.kind === "attach") {
      const source = launched.source;
      // ── State: attach ───────────────────────────────────────────────────
      updateSplashStatus("Opening dashboard…");
      const win = createMainWindow(source.url);
      closeSplash();
      showLoadingPage(win, source.url);
      createTray(() => mainWindow, requestQuit, {
        getServerOwnership,
        onLaunch: (force) => { void requestServerLaunch({ force }); },
      });
      startUpdaters();
      isStartingUp = false;
      // Detect + offer adoption of a leftover server from a prior Electron
      // lifetime. Fire-and-forget; the modal is non-blocking for startup.
      // See change: electron-attach-ownership-fixes.
      void maybePromptZombieAdoption();
      startRuntimeActivationWatcher(runtimeCtx);
      return;
    }

    updateSplashStatus("Launching dashboard server…");
    log(`[launch-source] spawned server pid=${launched.pid}`);
    setSpawnedPid(launched.pid);
    startRuntimeActivationWatcher(runtimeCtx);

    // ── State: health-wait → done ────────────────────────────────────────────
    // (`launchDashboardServer` inside `spawnFromSource` already waits for the
    // readiness signal; reaching here means health-wait completed.)
    updateSplashStatus("Opening dashboard…");
    const serverUrl = `http://localhost:${config.port}`;
    const win = createMainWindow(serverUrl);
    closeSplash();
    showLoadingPage(win, serverUrl);
    createTray(() => mainWindow, requestQuit, {
      getServerOwnership,
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
    createTray(() => mainWindow, requestQuit, {
      getServerOwnership,
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
    requestQuit();
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

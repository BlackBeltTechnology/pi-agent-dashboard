/**
 * Electron main process entry point.
 *
 * Flow:
 * 1. Single-instance lock
 * 2. First-run wizard (if ~/.pi-dashboard/mode.json is missing)
 * 3. Discover or launch dashboard server (mDNS → health check → spawn)
 * 4. Open BrowserWindow pointing at the server URL
 * 5. System tray (minimize on close, Show/Quit menu)
 */

import { app, BrowserWindow, dialog, shell } from "electron";
import { decideWillNavigate } from "./lib/link-handling.js";

// Enable Wayland support on Linux (auto-detect X11 vs Wayland)
if (process.platform === "linux" && !process.env.ELECTRON_OZONE_PLATFORM_HINT) {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
}
import { mkdirSync, appendFileSync } from "node:fs";
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
// VM detection now lives in the shared platform primitive.
// See change: consolidate-platform-handlers.
import { isVirtualMachine } from "@blackbelt-technology/pi-dashboard-shared/platform/commands.js";

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
import { isFirstRun, writeModeFile } from "./lib/wizard-state.js";
import { openWizardWindow, getWizardWindow } from "./lib/wizard-window.js";
import { registerWizardIpc } from "./lib/wizard-ipc.js";
import { ensureServer, stopServerIfNeeded, didWeStartServer, loadMinimalConfig } from "./lib/server-lifecycle.js";
import { isDashboardRunning } from "./lib/health-check.js";
import { detectPi, detectBridgeExtension } from "./lib/dependency-detector.js";
import { registerBundledBridgeExtension } from "./lib/bridge-register.js";
import { installStandalone } from "./lib/dependency-installer.js";
import { decideStartupAction, runPowerUserManagedInstall } from "./lib/power-user-install.js";
import { loadWindowState, saveWindowState } from "./lib/window-state.js";
import { createTray, destroyTray } from "./lib/tray.js";
import { startUpdateChecker } from "./lib/update-checker.js";
import { notifyUpdatesAvailable } from "./lib/update-notifier.js";
import { initAutoUpdater, quitAndInstall } from "./lib/app-updater.js";
import { setupAppMenu } from "./lib/app-menu.js";
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
    body { margin:0; display:flex; align-items:center; justify-content:center;
           height:100vh; background:transparent; -webkit-app-region:drag; }
    .card { background:#0d1117; border-radius:20px; padding:40px 48px;
            box-shadow:0 8px 32px rgba(0,0,0,0.5); text-align:center;
            min-width: 240px; }
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

/** Show a loading page that retries connecting to the server. */
function showLoadingPage(win: BrowserWindow, serverUrl: string): void {
  const config = loadMinimalConfig();
  const knownServersHtml = config.knownServers.length > 0
    ? `<div class="known-servers" id="known-servers" style="display:none; margin-top:20px; text-align:left;">
        <h3 style="color:#c9d1d9; font-size:14px; margin:0 0 8px;">Known Servers</h3>
        ${config.knownServers.map((s) =>
          `<button onclick="window.switchServer('${s.host}', ${s.port})" class="server-btn">
            <span class="server-label">${s.label || s.host}</span>
            <span class="server-addr">${s.host}:${s.port}</span>
          </button>`
        ).join("")}
      </div>`
    : "";

  const html = `
    <html>
    <head><style>
      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif;
             display: flex; align-items: center; justify-content: center;
             height: 100vh; margin: 0; background: #0d1117; color: #c9d1d9; }
      .container { text-align: center; max-width: 480px; padding: 0 24px; }
      .pi { font-size: 72px; color: #4a90d9; margin-bottom: 16px; }
      .status { font-size: 14px; color: #8b949e; }
      .error { display: none; margin-top: 24px; text-align: left; }
      .error h3 { color: #f85149; margin: 0 0 12px; font-size: 16px; }
      .error p { margin: 0 0 8px; font-size: 13px; line-height: 1.5; color: #8b949e; }
      .error code { background: #161b22; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
      .server-btn { display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 8px 12px;
        margin-bottom: 6px; background: #161b22; border: 1px solid #30363d; border-radius: 6px;
        color: #c9d1d9; cursor: pointer; font-size: 13px; text-align: left; }
      .server-btn:hover { border-color: #4a90d9; background: #1c2128; }
      .server-label { font-weight: 500; }
      .server-addr { color: #8b949e; font-size: 12px; }
      .dot { animation: blink 1.4s infinite; }
      .dot:nth-child(2) { animation-delay: 0.2s; }
      .dot:nth-child(3) { animation-delay: 0.4s; }
      @keyframes blink { 0%,20% { opacity: 0; } 50% { opacity: 1; } 100% { opacity: 0; } }
    </style></head>
    <body><div class="container">
      <div class="pi">π</div>
      <div class="status" id="status">Connecting to dashboard<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></div>
      <div class="error" id="error">
        <h3>Cannot connect to dashboard server</h3>
        <p>The server at <code>${serverUrl}</code> is not responding.</p>
        <p>Make sure the dashboard is installed and running:</p>
        <p><code>npm install -g @blackbelt-technology/pi-dashboard</code></p>
        <p><code>pi-dashboard start</code></p>
        <p style="margin-top: 16px; color: #c9d1d9;">The app will connect automatically once the server is available.</p>
        ${knownServersHtml}
      </div>
    </div>
    <script>
      window.switchServer = function(host, port) {
        window.location.href = 'http://' + host + ':' + port;
      };
    </script>
    </body>
    </html>`;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  let attempts = 0;
  const MAX_ATTEMPTS_BEFORE_ERROR = 10; // ~15 seconds

  const tryConnect = async () => {
    try {
      const res = await fetch(`${serverUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        win.loadURL(serverUrl);
        return;
      }
    } catch { /* not ready yet */ }

    attempts++;
    if (attempts === MAX_ATTEMPTS_BEFORE_ERROR) {
      // Show error message with known servers fallback, keep retrying
      win.webContents.executeJavaScript(`
        document.getElementById('status').style.display = 'none';
        document.getElementById('error').style.display = 'block';
        var ks = document.getElementById('known-servers');
        if (ks) ks.style.display = 'block';
      `).catch(() => {});
    }
    setTimeout(tryConnect, 1500);
  };
  setTimeout(tryConnect, 1000);
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
    },
  });

  if (state.isMaximized) mainWindow.maximize();

  // External-link hardening (issue #13, change: harden-external-link-handling).
  // Register BEFORE loadURL so the handlers are live for any navigation the
  // initial load triggers (e.g. an OAuth redirect that bounces through an
  // external provider).
  //
  // Layer 1: target=_blank / window.open → open in system browser, do NOT
  // spawn a secondary Electron BrowserWindow.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });
  // Layer 2: defense-in-depth for bare <a href> without target=_blank.
  // Same-origin navigation (e.g. /auth/login?return=/) proceeds normally;
  // external navigation is preempted and routed through the system browser
  // so the dashboard's only window is never replaced by a foreign page.
  //
  // The decision is **current-origin-aware** via `decideWillNavigate`: while
  // the user is mid-OAuth on a provider page (e.g. accounts.google.com), the
  // provider's internal multi-step navigation is allowed to proceed. The
  // trap guard fires only when leaving the dashboard. The eventual redirect
  // back to the dashboard origin is itself same-origin and lands cleanly.
  // See change: fix-oauth-blocked-by-external-link-guard.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL() ?? "";
    const decision = decideWillNavigate(serverUrl, currentUrl, url);
    if (decision === "open-external") {
      event.preventDefault();
      void shell.openExternal(url);
    } else if (decision === "cancel") {
      event.preventDefault();
    }
    // "allow" → do nothing, navigation proceeds.
  });

  mainWindow.loadURL(serverUrl);

  // Save window state on resize/move
  mainWindow.on("resize", () => mainWindow && saveWindowState(mainWindow));
  mainWindow.on("move", () => mainWindow && saveWindowState(mainWindow));

  // macOS: minimize to tray on close (standard macOS behavior)
  // Linux/Windows: quit on close (tray may not be visible)
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
  // Dependency updates (pi, openspec)
  cleanupUpdateChecker = startUpdateChecker(notifyUpdatesAvailable);

  // App self-update (electron-updater + GitHub Releases)
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
  cleanupUpdateChecker?.();
  cleanupAutoUpdater?.();
  await stopServerIfNeeded();
  destroyTray();
  app.quit();
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

  // Show splash screen immediately
  showSplash();

  // Set proper app name (overrides package.json name in dev mode)
  app.name = "PI Dashboard";

  // Set up macOS application menu (About, Edit, View, Window)
  setupAppMenu();

  // Register wizard IPC handlers
  registerWizardIpc(getWizardWindow);

  // Allow triggering setup wizard from menu (Doctor → Run Setup)
  app.on("run-setup-wizard" as any, async () => {
    await openWizardWindow();
  });

  // Pre-wizard: check if dashboard server is already running
  const config = loadMinimalConfig();
  updateSplashStatus("Checking dashboard server\u2026");
  const preCheck = await isDashboardRunning(config.port);
  log(`Pre-wizard health check: running=${preCheck.running}`);

  if (preCheck.running && isFirstRun()) {
    // Server is running — auto-write mode.json and skip wizard
    log("Server running, auto-writing mode.json as power-user");
    writeModeFile("power-user");
    try { registerBundledBridgeExtension(); } catch { /* non-fatal */ }
  }

  // First-run wizard (with smart detection)
  const firstRun = isFirstRun();
  log(`isFirstRun=${firstRun}`);
  if (firstRun) {
    // Server not running — check what's installed to decide wizard flow
    updateSplashStatus("Detecting pi agent\u2026");
    const pi = detectPi();
    updateSplashStatus("Checking bridge extension\u2026");
    const bridge = detectBridgeExtension();
    log(`Smart detection: pi=${pi.found}, bridge=${bridge.found}`);

    const startupAction = decideStartupAction({
      firstRun,
      piFound: pi.found,
      bridgeFound: bridge.found,
    });
    log(`startupAction=${startupAction.kind}${"step" in startupAction ? `:${startupAction.step}` : ""}`);

    if (startupAction.kind === "auto-skip-wizard-with-install") {
      // Both pi & bridge already on the system. Skip the wizard UI BUT
      // still run installStandalone() so ~/.pi-dashboard/node_modules/
      // has tsx + pi-coding-agent@0.70.0 + openspec for the bundled
      // server's runtime. See change:
      // fix-electron-windows-installer-and-server-bootstrap (Defect 1).
      log("Pi + bridge detected, auto-writing mode.json as power-user");
      writeModeFile("power-user");
      try { registerBundledBridgeExtension(); } catch { /* non-fatal */ }
      const installResult = await runPowerUserManagedInstall({
        installStandaloneFn: installStandalone,
        onStatus: (s) => updateSplashStatus(s),
      });
      log(`runPowerUserManagedInstall: ran=${installResult.ran} reason=${installResult.reason}${installResult.error ? ` error=${installResult.error.message}` : ""}`);
      if (installResult.reason === "failed") {
        // Surface as a non-fatal warning — the next ensureServer attempt
        // will fail with a clearer message if the loader is genuinely
        // unavailable. See change: fix-electron-windows-installer-and-
        // server-bootstrap (Defect 1, design.md §Open Question 1).
        console.error("[pi-dashboard] managed install failed:", installResult.error?.message);
      }
    } else if (pi.found && !bridge.found) {
      // Pi found but no bridge — targeted wizard
      updateSplashStatus("Opening setup wizard\u2026");
      closeSplash();
      log("Opening wizard at bridge-install step...");
      await openWizardWindow("bridge-install");
      log("Wizard window closed");
      if (isFirstRun()) {
        log("Wizard not completed, quitting");
        app.quit();
        return;
      }
    } else {
      // Nothing found — full wizard
      updateSplashStatus("Opening setup wizard\u2026");
      closeSplash();
      log("Opening wizard window...");
      await openWizardWindow();
      log("Wizard window closed");
      if (isFirstRun()) {
        log("Wizard not completed, quitting");
        app.quit();
        return;
      }
    }
  }

  // Dev mode: skip discovery, wait for server
  if (process.env.ELECTRON_DEV) {
    const devUrl = "http://localhost:8000";
    const win = createMainWindow(devUrl);
    showLoadingPage(win, devUrl);
    createTray(() => mainWindow, quit);
    startUpdaters();
    isStartingUp = false;
    return;
  }

  // Discover or launch server — retry up to 2 times with wizard fallback
  let serverUrl: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      updateSplashStatus(
        attempt === 0
          ? "Launching dashboard server\u2026"
          : `Retrying server launch (attempt ${attempt + 1})\u2026`,
      );
      log(`ensureServer attempt ${attempt + 1}...`);
      serverUrl = await ensureServer();
      log(`Server found at ${serverUrl}`);
      break;
    } catch (err: any) {
      console.error(`ensureServer attempt ${attempt + 1} failed:`, err.message);
      log(`ensureServer failed: ${err.message}`);

      closeSplash();
      const { response } = await dialog.showMessageBox({
        type: "error",
        title: "PI Dashboard",
        message: "Could not start the dashboard server.",
        detail: `${err.message}\n\nWould you like to run the setup wizard to fix this?`,
        buttons: ["Run Setup", "Retry", "Quit"],
        defaultId: 0,
      });

      if (response === 0) {
        // Run Setup
        await openWizardWindow();
        // Continue loop to retry ensureServer
      } else if (response === 1) {
        // Retry — continue loop
      } else {
        app.quit();
        return;
      }
    }
  }

  if (!serverUrl) {
    // All attempts exhausted — show loading page with connection retry
    // Use default port (can't import shared config in packaged app)
    serverUrl = "http://localhost:8000";
  }

  updateSplashStatus("Opening dashboard\u2026");
  const win = createMainWindow(serverUrl);
  closeSplash();
  showLoadingPage(win, serverUrl);
  createTray(() => mainWindow, quit);
  startUpdaters();
  isStartingUp = false;
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

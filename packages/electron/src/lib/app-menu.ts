/**
 * Application menu for all platforms.
 * - macOS: App menu (About, Doctor), Edit, View, Window
 * - Windows/Linux: top-level About, Doctor, View (reload, devtools, zoom)
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, Menu, type MenuItemConstructorOptions, shell } from "electron";
import { checkForUpdatesNow, getUpdateLogPath } from "./app-updater.js";
import { openDoctorWindow } from "./doctor-window.js";
import { openRemoteConnectWindow, useLocalDashboard } from "./remote-connect-window.js";

/** True when running an unpackaged dev build; hides the update-check item. */
function isDevMode(): boolean {
  return !!process.env.ELECTRON_DEV || !(process as { resourcesPath?: string }).resourcesPath;
}

/**
 * Manual "Check for updates…" handler. Triggers an immediate check and shows
 * the up-to-date / error dialog. The update-available case is handled by the
 * `update-available` event listener registered in main.ts (no duplication).
 */
async function handleCheckForUpdates(): Promise<void> {
  const result = await checkForUpdatesNow();
  if (result.type === "up-to-date") {
    dialog.showMessageBox({
      type: "info",
      title: "Check for Updates",
      message: "You're up to date",
      detail: `PI Dashboard v${result.version} is the latest version.`,
      buttons: ["OK"],
    });
  } else if (result.type === "error") {
    dialog.showMessageBox({
      type: "warning",
      title: "Check for Updates",
      message: "Update check failed",
      detail: result.message,
      buttons: ["OK"],
    });
  }
  // result.type === "update-available": the standard dialog is shown by the
  // autoUpdater "update-available" listener wired in main.ts.
}

/** Reveal the updater log file in the OS file manager. */
function handleViewUpdateLog(): void {
  const logPath = getUpdateLogPath();
  if (logPath) shell.showItemInFolder(logPath);
  else dialog.showMessageBox({ type: "info", title: "Update Log", message: "No update log available.", buttons: ["OK"] });
}

/**
 * Bundled Git for Windows license probe. Returns the THIRD-PARTY-LICENSE.txt
 * path + parsed git version when the bundled git tree is present (win32
 * installs only). See change: embed-git-bash-on-windows.
 */
function bundledGitLicense(): { file: string; version: string } | null {
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) return null;
  const file = path.join(resourcesPath, "git", "THIRD-PARTY-LICENSE.txt");
  if (!existsSync(file)) return null;
  let version = "";
  try {
    const m = readFileSync(file, "utf8").match(/^Git version:\s*(.+)$/m);
    if (m) version = m[1].trim();
  } catch { /* ignore */ }
  return { file, version };
}

function showAboutDialog(): void {
  const git = bundledGitLicense();
  const detail =
    `Version ${app.getVersion()}\n\nMonitor and interact with pi agent sessions.\n\n© Blackbelt Technology` +
    (git ? `\n\nBundled Git for Windows v${git.version || "(bundled)"} — GPLv2` : "");
  const buttons = git ? ["OK", "Open Bundled Git License"] : ["OK"];
  dialog
    .showMessageBox({
      type: "info",
      title: `About ${app.name}`,
      message: `${app.name}`,
      detail,
      buttons,
      defaultId: 0,
      cancelId: 0,
    })
    .then((res) => {
      if (git && res.response === 1) shell.openPath(git.file);
    });
}

/**
 * Open the dedicated Doctor BrowserWindow.
 *
 * Replaces the legacy native dialog. Idempotent: a second click focuses
 * the existing window. See change: doctor-rich-output (task 3.6).
 */
export async function showDoctorDialog(): Promise<void> {
  openDoctorWindow();
}

export function setupAppMenu(): void {
  if (process.platform === "darwin") {
    const template: MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          { label: `About ${app.name}`, click: () => showAboutDialog() },
          { type: "separator" },
          ...(isDevMode() ? [] : [{ label: "Check for Updates…", click: () => handleCheckForUpdates() }]),
          { label: "View Update Log", click: () => handleViewUpdateLog() },
          { type: "separator" },
          { label: "Doctor...", click: () => showDoctorDialog() },
          { label: "Connect to Remote Dashboard…", click: () => openRemoteConnectWindow() },
          { label: "Use Local Dashboard", click: () => useLocalDashboard() },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Window",
        submenu: [
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" },
          { role: "close" },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    return;
  }

  // Windows / Linux — flat top-level items
  const template: MenuItemConstructorOptions[] = [
    {
      label: "View",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => BrowserWindow.getFocusedWindow()?.webContents.reload() },
        { label: "Force Reload", accelerator: "CmdOrCtrl+Shift+R", click: () => BrowserWindow.getFocusedWindow()?.webContents.reloadIgnoringCache() },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    ...(isDevMode() ? [] : [{ label: "Check for Updates…", click: () => handleCheckForUpdates() }]),
    {
      label: "View Update Log",
      click: () => handleViewUpdateLog(),
    },
    {
      label: "About",
      click: () => showAboutDialog(),
    },
    {
      label: "Doctor",
      click: () => showDoctorDialog(),
    },
    {
      label: "Connect to Remote Dashboard…",
      click: () => openRemoteConnectWindow(),
    },
    {
      label: "Use Local Dashboard",
      click: () => useLocalDashboard(),
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

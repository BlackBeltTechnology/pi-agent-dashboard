/**
 * Application menu for all platforms.
 * - macOS: App menu (About, Doctor), Edit, View, Window
 * - Windows/Linux: top-level About, Doctor, View (reload, devtools, zoom)
 */
import { app, Menu, clipboard, dialog, BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { runDoctor, formatDoctorReport } from "./doctor.js";

function showAboutDialog(): void {
  dialog.showMessageBox({
    type: "info",
    title: `About ${app.name}`,
    message: `${app.name}`,
    detail: `Version ${app.getVersion()}\n\nMonitor and interact with pi agent sessions.\n\n© Blackbelt Technology`,
  });
}

export async function showDoctorDialog(): Promise<void> {
  const report = await runDoctor();
  const text = formatDoctorReport(report);

  const buttons = ["Copy to Clipboard"];
  if (report.summary.errors > 0) buttons.push("Run Setup");
  buttons.push("OK");

  dialog.showMessageBox({
    type: report.summary.errors > 0 ? "warning" : "info",
    title: "PI Dashboard Doctor",
    message: `${report.summary.ok} passed, ${report.summary.warnings} warnings, ${report.summary.errors} errors`,
    detail: text,
    buttons,
  }).then(({ response }) => {
    if (buttons[response] === "Copy to Clipboard") {
      clipboard.writeText(text);
    } else if (buttons[response] === "Run Setup") {
      app.emit("run-setup-wizard" as any);
    }
  });
}

export function setupAppMenu(): void {
  if (process.platform === "darwin") {
    const template: MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          { label: `About ${app.name}`, click: () => showAboutDialog() },
          { type: "separator" },
          { label: "Doctor...", click: () => showDoctorDialog() },
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
    {
      label: "About",
      click: () => showAboutDialog(),
    },
    {
      label: "Doctor",
      click: () => showDoctorDialog(),
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

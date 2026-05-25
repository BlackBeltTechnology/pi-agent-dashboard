/**
 * Creates and manages the first-run wizard window.
 */
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getPreloadPath(): string {
  // Packaged: preload.js is in .vite/build/ (same dir as main.js)
  const packaged = path.join(__dirname, "preload.js");
  if (existsSync(packaged)) return packaged;
  // Dev via forge: .vite/build/preload.js
  const forgeDev = path.join(process.cwd(), ".vite", "build", "preload.js");
  if (existsSync(forgeDev)) return forgeDev;
  // Dev direct: src/preload.ts won't work, fallback
  return packaged;
}

let wizardWindow: BrowserWindow | null = null;

/**
 * Open the first-run wizard window.
 * Returns a promise that resolves when the wizard is closed.
 */
export function openWizardWindow(startStep?: string): Promise<void> {
  return new Promise((resolve) => {
    wizardWindow = new BrowserWindow({
      width: 640,
      height: 520,
      resizable: false,
      titleBarStyle: "hiddenInset",
      // No-flash pattern: construct hidden, show on 'ready-to-show'. Also
      // guarantees focus is claimed over any lingering sibling window (e.g.
      // the alwaysOnTop splash) on Windows where show:true does NOT steal
      // focus from an alwaysOnTop sibling. See change: fix-wizard-occluded-by-splash.
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: getPreloadPath(),
      },
    });

    // In packaged app: renderer/ is in extraResource (process.resourcesPath/renderer/)
    // In dev: relative to src/lib/ → ../renderer/
    let wizardHtml = path.join(__dirname, "..", "renderer", "wizard.html");
    if (!existsSync(wizardHtml) && (process as any).resourcesPath) {
      wizardHtml = path.join((process as any).resourcesPath, "renderer", "wizard.html");
    }
    wizardWindow.loadFile(wizardHtml, startStep ? { query: { start: startStep } } : undefined);

    wizardWindow.once("ready-to-show", () => {
      // Pair show + focus so the wizard claims the foreground even if the
      // splash window is still in the process of closing or otherwise sits
      // at the top of the z-order. See change: fix-wizard-occluded-by-splash.
      wizardWindow?.show();
      wizardWindow?.focus();
    });

    wizardWindow.on("closed", () => {
      wizardWindow = null;
      resolve();
    });
  });
}

export function getWizardWindow(): BrowserWindow | null {
  return wizardWindow;
}

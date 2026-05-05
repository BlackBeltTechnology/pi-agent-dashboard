/**
 * System tray integration.
 * Minimizes to tray on window close, with Start/Restart server, Show, Quit menu.
 *
 * The first menu item is dynamic: shows "Start server" when no managed server
 * is running and "Restart server" when one is. The menu is rebuilt every 3 s
 * via a polled `getServerStatus()` callback so state changes (server started
 * by a `pi` session, or stopped externally) are reflected promptly.
 *
 * See change: electron-server-launch-controls (D3, R4).
 */
import { app, Tray, Menu, nativeImage, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;
let pollInterval: NodeJS.Timeout | null = null;
let lastIsRunning: boolean | null = null;

/** Resolve path to a resource file (works in both dev and packaged modes). */
function resourcePath(filename: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, filename);
  }
  return path.join(__dirname, "..", "..", "resources", filename);
}

/**
 * Pure menu-template builder. Exported for unit testing.
 *
 * Behaviour:
 * - When `isRunning === true` → first item is "Restart server" (passes `force: true`).
 * - When `isRunning === false` → first item is "Start server" (passes `force: false`).
 * - When `isRunning === null` (status unknown, first poll pending) → omit the
 *   server-launch item to avoid showing a misleading label.
 */
export function buildTrayMenuTemplate(args: {
  isRunning: boolean | null;
  onLaunch: (force: boolean) => void;
  onShow: () => void;
  onQuit: () => void;
}): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  if (args.isRunning === true) {
    items.push({ label: "Restart server", click: () => args.onLaunch(true) });
  } else if (args.isRunning === false) {
    items.push({ label: "Start server", click: () => args.onLaunch(false) });
  }
  if (items.length > 0) items.push({ type: "separator" });
  items.push({ label: "Show", click: args.onShow });
  items.push({ type: "separator" });
  items.push({ label: "Quit", click: args.onQuit });
  return items;
}

/**
 * Create the system tray icon with context menu.
 *
 * @param getWindow callback returning the main window (may be null while hidden)
 * @param onQuit callback invoked when the user explicitly quits
 * @param hooks optional callbacks for the dynamic server-launch item:
 *   - `getServerStatus()` returns the current `isRunning` boolean
 *   - `onLaunch(force)` invoked when the user clicks Start/Restart
 *   When `hooks` is omitted the menu falls back to the legacy Show/Quit-only form.
 */
export function createTray(
  getWindow: () => BrowserWindow | null,
  onQuit: () => void,
  hooks?: {
    getServerStatus: () => Promise<boolean>;
    onLaunch: (force: boolean) => void;
  },
): Tray {
  let icon: Electron.NativeImage;
  if (process.platform === "darwin") {
    icon = nativeImage.createFromPath(resourcePath("trayTemplate.png"));
    icon.setTemplateImage(true);
  } else if (process.platform === "win32") {
    icon = nativeImage.createFromPath(resourcePath("icon.ico"));
  } else {
    icon = nativeImage.createFromPath(resourcePath("icon.png"));
  }
  tray = new Tray(icon);
  tray.setToolTip("PI Dashboard");

  const showWindow = (): void => {
    const win = getWindow();
    if (win) {
      win.show();
      win.focus();
    }
  };

  const rebuildMenu = (isRunning: boolean | null): void => {
    if (!tray) return;
    const template = buildTrayMenuTemplate({
      isRunning,
      onLaunch: hooks?.onLaunch ?? (() => { /* no hook configured */ }),
      onShow: showWindow,
      onQuit,
    });
    tray.setContextMenu(Menu.buildFromTemplate(template));
  };

  // Initial render — if hooks are configured, hide the launch item until
  // the first probe resolves; else render the legacy menu shape.
  rebuildMenu(hooks ? null : false);

  if (hooks) {
    const probe = async (): Promise<void> => {
      try {
        const isRunning = await hooks.getServerStatus();
        if (isRunning !== lastIsRunning) {
          lastIsRunning = isRunning;
          rebuildMenu(isRunning);
        }
      } catch { /* ignore probe failures */ }
    };
    void probe();
    pollInterval = setInterval(() => { void probe(); }, 3000);
  }

  tray.on("click", showWindow);
  return tray;
}

export function destroyTray(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  lastIsRunning = null;
  tray?.destroy();
  tray = null;
}

/**
 * System tray integration.
 * Minimizes to tray on window close, with Start/Restart server, Show, Quit menu.
 *
 * The first menu item is dynamic and ownership-aware: "Start server" when no
 * server is running, "Restart server" when this Electron owns it, and a
 * disabled "Server managed externally" row when a foreign server holds the
 * port. The menu is rebuilt every 3 s via a polled `getServerOwnership()`
 * callback so state changes are reflected promptly.
 *
 * See change: electron-server-launch-controls (D3, R4);
 * electron-attach-ownership-fixes (ownership-aware menu).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, type BrowserWindow, Menu, type MenuItemConstructorOptions, nativeImage, Tray } from "electron";
import { onServersMenuChanged, serversMenuItem } from "./servers-menu.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Server ownership as seen by the tray probe. Widens the old binary
 * running/not-running model to a three-way ownership classification so the
 * tray never offers a "Restart" action against a server this Electron doesn't
 * own. See change: electron-attach-ownership-fixes.
 */
export type TrayOwnership = "electron" | "foreign" | "none" | "unknown";

let tray: Tray | null = null;
let pollInterval: NodeJS.Timeout | null = null;
let lastOwnership: TrayOwnership | null = null;
let unsubscribeServersMenu: (() => void) | null = null;

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
 * Behaviour (keyed on ownership):
 * - `"electron"` → first item is "Restart server" (passes `force: true`).
 * - `"none"`     → first item is "Start server" (passes `force: false`).
 * - `"foreign"`  → first item is a disabled "Server managed externally" row
 *   (no click handler) so the tray never offers a Restart that could nuke a
 *   server this Electron doesn't own.
 * - `"unknown"` (status unknown, first poll pending / probe error) → omit the
 *   server-launch item to avoid showing a misleading label.
 */
export function buildTrayMenuTemplate(args: {
  ownership: TrayOwnership;
  onLaunch: (force: boolean) => void;
  onShow: () => void;
  onQuit: () => void;
  /** Servers submenu item (paired dashboards). See change: add-electron-server-windows. */
  servers?: MenuItemConstructorOptions;
}): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  if (args.ownership === "electron") {
    items.push({ label: "Restart server", click: () => args.onLaunch(true) });
  } else if (args.ownership === "none") {
    items.push({ label: "Start server", click: () => args.onLaunch(false) });
  } else if (args.ownership === "foreign") {
    items.push({ label: "Server managed externally", enabled: false });
  }
  if (items.length > 0) items.push({ type: "separator" });
  items.push({ label: "Show", click: args.onShow });
  if (args.servers) items.push(args.servers);
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
 *   - `getServerOwnership()` returns the current ownership classification
 *   - `onLaunch(force)` invoked when the user clicks Start/Restart
 *   When `hooks` is omitted the menu falls back to the legacy Show/Quit-only form.
 */
export function createTray(
  getWindow: () => BrowserWindow | null,
  onQuit: () => void,
  hooks?: {
    getServerOwnership: () => Promise<TrayOwnership>;
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

  const rebuildMenu = (ownership: TrayOwnership): void => {
    if (!tray) return;
    const template = buildTrayMenuTemplate({
      ownership,
      onLaunch: hooks?.onLaunch ?? (() => { /* no hook configured */ }),
      onShow: showWindow,
      onQuit,
      servers: serversMenuItem(),
    });
    tray.setContextMenu(Menu.buildFromTemplate(template));
  };
  // Rebuild when the keyring changes (pair / forget / needs pairing).
  unsubscribeServersMenu?.();
  unsubscribeServersMenu = onServersMenuChanged(() => rebuildMenu(lastOwnership ?? (hooks ? "unknown" : "none")));

  // Initial render — if hooks are configured, hide the launch item until
  // the first probe resolves ("unknown"); else render the legacy menu shape
  // ("none" → Start server).
  rebuildMenu(hooks ? "unknown" : "none");

  if (hooks) {
    const probe = async (): Promise<void> => {
      try {
        const ownership = await hooks.getServerOwnership();
        if (ownership !== lastOwnership) {
          lastOwnership = ownership;
          rebuildMenu(ownership);
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
  lastOwnership = null;
  unsubscribeServersMenu?.();
  unsubscribeServersMenu = null;
  tray?.destroy();
  tray = null;
}

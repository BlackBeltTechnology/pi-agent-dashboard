/**
 * Electron wiring for server windows: builds the real keyring (`safeStorage`),
 * discovery (mDNS), window ports (`BrowserWindow`, `session`, `dialog`,
 * `powerMonitor`), the `servers:*` IPC and the Servers menu hooks, and returns a
 * handle `main.ts` closes at quit.
 *
 * Everything with logic lives in the Electron-free modules (`server-keyring`,
 * `server-discovery`, `pairing-client`, `server-windows`, `servers-ipc`,
 * `servers-menu`); this file only binds them to Electron objects.
 *
 * See change: add-electron-server-windows (D1, D9, D10).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { proveServerIdentity } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";
import { BrowserWindow, dialog, ipcMain, powerMonitor, safeStorage, screen, session } from "electron";
import { CONNECTING_HTML, getConnectingWindow, openConnectingWindow } from "./connecting-window.js";
import { MANAGED_DIR } from "./managed-paths.js";
import { getRemoteConnectHtmlPath, getRemoteConnectWindow, openRemoteConnectWindow } from "./remote-connect-window.js";
import { getRendererHtmlPath } from "./renderer-paths.js";
import { createServerDiscovery, type ServerDiscovery } from "./server-discovery.js";
import { loadKeyring, type ServerKeyring } from "./server-keyring.js";
import { type Bounds, createServerWindows, type ServerWindowPorts, type ServerWindows } from "./server-windows.js";
import { registerServersIpc, type ServersIpc, type TrustedWindow } from "./servers-ipc.js";
import { notifyServersMenuChanged, setServersMenuHooks } from "./servers-menu.js";
import { listRecentRemotes } from "./wizard-state.js";

const BOUNDS_FILE = "server-windows-state.json";

export interface ServerWindowsMainOptions {
  getMainWindow: () => BrowserWindow | null;
  /** Origin of the local dashboard this app launched/adopted; undefined in remote mode. */
  getLocalOrigin: () => string | undefined;
  /** Hand a URL to the OS browser (scheme allowlist applied by the caller). */
  openExternal: (url: string) => void;
  /** True when Chromium's CDP debug surface is active (credentials in partitions are then readable locally). */
  cdpActive: boolean;
  log: (line: string) => void;
}

export interface ServerWindowsHandle {
  keyring: ServerKeyring;
  serverWindows: ServerWindows;
  discovery: ServerDiscovery;
  ipc: ServersIpc;
  /** Re-resolve the local dashboard's fingerprint (call once the local server is healthy). */
  resolveLocalFp(): Promise<void>;
  dispose(): void;
}

/** Window bounds per fingerprint, in `server-windows-state.json` (outside the keyring). */
function createBoundsStore(dir: string) {
  const file = path.join(dir, BOUNDS_FILE);
  const read = (): Record<string, Bounds> => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Bounds>;
    } catch {
      return {};
    }
  };
  const write = (all: Record<string, Bounds>): void => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
    } catch {
      /* non-critical */
    }
  };
  /** Drop a saved position that is no longer on any display (unplugged monitor). */
  const visible = (b: Bounds): Bounds => {
    if (b.x === undefined || b.y === undefined) return b;
    try {
      const ok = screen.getAllDisplays().some((d) => {
        const w = d.workArea;
        return Math.min(b.x! + b.width, w.x + w.width) - Math.max(b.x!, w.x) >= 50 && Math.min(b.y! + b.height, w.y + w.height) - Math.max(b.y!, w.y) >= 50;
      });
      return ok ? b : { width: b.width, height: b.height };
    } catch {
      return b;
    }
  };
  return {
    get: (fp: string): Bounds | undefined => {
      const b = read()[fp];
      return b && Number.isFinite(b.width) && Number.isFinite(b.height) ? visible(b) : undefined;
    },
    set: (fp: string, b: Bounds): void => write({ ...read(), [fp]: b }),
    remove: (fp: string): void => {
      const all = read();
      delete all[fp];
      write(all);
    },
  };
}

export function startServerWindows(opts: ServerWindowsMainOptions): ServerWindowsHandle {
  const { log } = opts;
  const keyring = loadKeyring({ dir: MANAGED_DIR, crypto: safeStorage, log });

  // The ipc object is created after the controllers; callbacks below use it lazily.
  let ipc: ServersIpc | null = null;
  const changed = (): void => {
    ipc?.broadcast();
    notifyServersMenuChanged();
  };

  // The local origin is only known once the main window exists (and never in remote mode, where no
  // local server runs and nothing needs excluding) — resolve it lazily at each attempt.
  const proveLocal = async (): Promise<string | undefined> => {
    const origin = opts.getLocalOrigin();
    if (!origin) return undefined;
    const r = await proveServerIdentity(origin);
    return "proven" in r ? r.proven : undefined;
  };
  const discovery = createServerDiscovery({ isPaired: (fp) => keyring.has(fp), proveLocal, onChange: changed });
  let localFpTimer: ReturnType<typeof setTimeout> | null = null;

  const bounds = createBoundsStore(MANAGED_DIR);
  let connectingHandle: ReturnType<typeof openConnectingWindow> | null = null;

  const ports: ServerWindowPorts = {
    createWindow: (o) => new BrowserWindow(o) as never,
    sessionFor: (partition) => session.fromPartition(partition) as never,
    openExternal: opts.openExternal,
    askNeedsPairing: async (label) => {
      const { response } = await dialog.showMessageBox({
        type: "warning",
        title: "Pair again?",
        message: `${label} no longer accepts this computer.`,
        detail: "The device may have been revoked on that dashboard. You can pair again, or forget this server.",
        buttons: ["Pair again", "Forget", "Close"],
        defaultId: 0,
        cancelId: 2,
      });
      return response === 0 ? "pair-again" : response === 1 ? "forget" : "close";
    },
    notify: (title, message) => {
      dialog.showMessageBox({ type: "info", title, message, buttons: ["OK"] }).catch(() => {});
    },
    openConnectingWindow: (initial) => {
      connectingHandle = openConnectingWindow(() => serverWindows.stopWaiting(), initial);
      return connectingHandle;
    },
    bounds,
    onResume: (cb) => {
      powerMonitor.on("resume", cb);
      return () => powerMonitor.removeListener("resume", cb);
    },
    deviceName: () => os.hostname(),
  };

  const serverWindows = createServerWindows({
    keyring,
    discovery,
    ports,
    prove: (baseUrl) => proveServerIdentity(baseUrl),
    log,
  });

  const trustedWindows = (): TrustedWindow[] => {
    const out: TrustedWindow[] = [];
    const main = opts.getMainWindow();
    if (main && !main.isDestroyed()) out.push({ kind: "main", webContents: main.webContents as never, topUrl: () => main.webContents.getURL(), isDestroyed: () => main.isDestroyed() });
    const rc = getRemoteConnectWindow();
    if (rc) out.push({ kind: "remote-connect", webContents: rc.webContents as never, expectedFile: getRemoteConnectHtmlPath(), topUrl: () => rc.webContents.getURL(), isDestroyed: () => rc.isDestroyed() });
    const cw = getConnectingWindow();
    if (cw) out.push({ kind: "connecting", webContents: cw.webContents as never, expectedFile: getRendererHtmlPath(CONNECTING_HTML), topUrl: () => cw.webContents.getURL(), isDestroyed: () => cw.isDestroyed() });
    return out;
  };

  ipc = registerServersIpc({
    ipcMain,
    trust: { windows: trustedWindows, localOrigin: opts.getLocalOrigin },
    serverWindows,
    keyring,
    discovery,
    recent: () => listRecentRemotes(),
    closeConnecting: () => {
      serverWindows.stopWaiting();
      connectingHandle?.close();
    },
    log,
  });

  keyring.onChange(changed);
  setServersMenuHooks({
    entries: () => keyring.list().map((e) => ({ fingerprint: e.fingerprint, label: e.label, needsPairing: e.needsPairing })),
    open: (fp) => void serverWindows.open(fp, { notify: true }),
    connectAnother: () => void openRemoteConnectWindow(),
  });
  notifyServersMenuChanged();

  if (opts.cdpActive && keyring.list().length > 0) {
    log(`[server-windows] WARNING: CDP debug surface is active and ${keyring.list().length} paired server(s) exist — any local process can read their partition cookies (device credentials)`);
  }

  // The local server may still be starting: retry until its identity answers (or we give up).
  let attempts = 0;
  const tryLocalFp = (): void => {
    attempts++;
    discovery
      .resolveLocalFp()
      .then(() => {
        if (discovery.hasLocalFp() || attempts >= 8) return;
        localFpTimer = setTimeout(tryLocalFp, Math.min(5000 * attempts, 30_000));
        localFpTimer.unref?.();
      })
      .catch(() => {});
  };
  localFpTimer = setTimeout(tryLocalFp, 2000);
  localFpTimer.unref?.();

  return {
    keyring,
    serverWindows,
    discovery,
    ipc,
    resolveLocalFp: () => discovery.resolveLocalFp(),
    dispose() {
      if (localFpTimer) clearTimeout(localFpTimer);
      serverWindows.closeAll();
      discovery.stop();
      setServersMenuHooks(null);
    },
  };
}

/**
 * "Connect to Remote Dashboard" window factory + IPC.
 *
 * Replaces the deleted first-run wizard's remote-attach path. Opened from the
 * app menu (`Connect to Remote Dashboard…`). A slim renderer
 * (`remote-connect.html`) collects a URL, probes it, and on connect writes
 * `dashboard-settings.json` remote mode + relaunches the app so startup
 * re-reads the setting and attaches. The recent-servers MRU list lives in the
 * same settings file (shell-local — the shell decides attach-vs-spawn at
 * startup, before any server connection, so the list cannot be server-hosted).
 *
 * See change: auto-launch-first-run-skip-welcome (Section 2B).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import {
  addRecentRemote,
  listRecentRemotes,
  type RecentRemote,
  readModeFile,
  removeRecentRemote,
  type WizardMode,
  writeModeFile,
} from "./wizard-state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let remoteConnectWindow: BrowserWindow | null = null;
let handlersRegistered = false;

function getPreloadPath(): string {
  const packaged = path.join(__dirname, "preload.js");
  if (existsSync(packaged)) return packaged;
  const forgeDev = path.join(process.cwd(), ".vite", "build", "preload.js");
  if (existsSync(forgeDev)) return forgeDev;
  return packaged;
}

function getHtmlPath(): string {
  let p = path.join(__dirname, "..", "renderer", "remote-connect.html");
  if (!existsSync(p) && (process as { resourcesPath?: string }).resourcesPath) {
    p = path.join((process as { resourcesPath: string }).resourcesPath, "renderer", "remote-connect.html");
  }
  return p;
}

/** Normalize a user-entered URL: trim, default http://, strip trailing slash. */
export function normalizeRemoteUrl(input: unknown): string | null {
  const v = typeof input === "string" ? input.trim() : "";
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `http://${v}`;
  return withScheme.replace(/\/+$/, "");
}

export interface RemoteProbeResult {
  ok: boolean;
  version?: string;
  reason?: string;
}

/** Probe `${url}/api/health` with a short timeout. */
export async function probeRemote(url: string): Promise<RemoteProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${url}/api/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    let version: string | undefined;
    try {
      const body = (await res.json()) as { version?: string };
      if (typeof body?.version === "string") version = body.version;
    } catch { /* health may return non-JSON */ }
    return { ok: true, version };
  } catch (err) {
    const reason = (err as Error)?.name === "AbortError" ? "Timed out" : "Connection refused";
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

/** Restart the app so startup re-reads the mode setting. */
function relaunch(): void {
  app.relaunch();
  app.quit();
}

export interface RemoteConnectState {
  mode: WizardMode;
  remoteUrl?: string;
  recent: RecentRemote[];
}

function registerHandlersOnce(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle("remote-connect:get-state", (): RemoteConnectState => {
    const cfg = readModeFile();
    return {
      mode: cfg?.mode ?? "standalone",
      remoteUrl: cfg?.remoteUrl,
      recent: listRecentRemotes(),
    };
  });

  ipcMain.handle("remote-connect:probe", async (_evt, rawUrl: unknown): Promise<RemoteProbeResult> => {
    const url = normalizeRemoteUrl(rawUrl);
    if (!url) return { ok: false, reason: "Enter a URL (e.g. http://hostname:8000)" };
    return probeRemote(url);
  });

  // Connect to a remote dashboard. Untrusted renderer input — validate before
  // writing config. Saved servers are pre-trusted (already probed on the way
  // in), so this handler does NOT re-probe; it persists + relaunches.
  ipcMain.handle("remote-connect:connect", async (_evt, rawUrl: unknown): Promise<void> => {
    const url = normalizeRemoteUrl(rawUrl);
    if (!url) throw new Error("remote-connect:connect requires a non-empty URL");
    addRecentRemote(url);
    writeModeFile("remote", url);
    relaunch();
  });

  ipcMain.handle("remote-connect:use-local", async (): Promise<void> => {
    writeModeFile("standalone");
    relaunch();
  });

  ipcMain.handle("remote-connect:forget", async (_evt, rawUrl: unknown): Promise<RecentRemote[]> => {
    const url = normalizeRemoteUrl(rawUrl);
    return url ? removeRecentRemote(url) : listRecentRemotes();
  });

  ipcMain.on("remote-connect:close", () => {
    if (remoteConnectWindow && !remoteConnectWindow.isDestroyed()) remoteConnectWindow.close();
  });
}

/** Open (or focus) the remote-connect window. */
export function openRemoteConnectWindow(): BrowserWindow {
  registerHandlersOnce();

  if (remoteConnectWindow && !remoteConnectWindow.isDestroyed()) {
    if (remoteConnectWindow.isMinimized()) remoteConnectWindow.restore();
    remoteConnectWindow.focus();
    return remoteConnectWindow;
  }

  remoteConnectWindow = new BrowserWindow({
    width: 520,
    height: 640,
    resizable: false,
    title: "Connect to Remote Dashboard",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: getPreloadPath(),
    },
  });

  remoteConnectWindow.loadFile(getHtmlPath());

  remoteConnectWindow.on("closed", () => {
    remoteConnectWindow = null;
  });

  return remoteConnectWindow;
}

/** Reset to the local (standalone) dashboard and relaunch. Pure main-process action. */
export function useLocalDashboard(): void {
  writeModeFile("standalone");
  relaunch();
}

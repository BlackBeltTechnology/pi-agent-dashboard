/**
 * Remote-connect preload bridge. Exposes `window.remoteConnect` to the
 * `remote-connect.html` renderer.
 *
 * Side-effect imported once from `packages/electron/src/preload.ts` (the
 * WIZARD preload bundle, alongside the doctor bridge). Never carried by the
 * main-window preload (`preload-main.ts`).
 *
 * See change: auto-launch-first-run-skip-welcome (Section 2B).
 */
import { contextBridge, ipcRenderer } from "electron";

export interface RecentRemote {
  url: string;
  lastUsed: string;
}

export interface RemoteConnectState {
  mode: "standalone" | "power-user" | "remote";
  remoteUrl?: string;
  recent: RecentRemote[];
}

export interface RemoteProbeResult {
  ok: boolean;
  version?: string;
  reason?: string;
}

/** Paired / discovered rows from the main-process `servers:*` family (no bearer ever included). */
export interface PairedServerRow {
  fingerprint: string;
  label: string;
  shortFp: string;
  state: "paired" | "needs-pairing";
  open: boolean;
  remembered: boolean;
  host?: string;
}

export interface DiscoveredServerRow {
  key: string;
  name: string;
  host: string;
  port: number;
  addresses: string[];
  fingerprint?: string;
  state: "not-paired" | "paired" | "identity-not-advertised";
  note?: string;
}

export interface ServersState {
  paired: PairedServerRow[];
  discovered: DiscoveredServerRow[];
  recent: RecentRemote[];
}

export type ServerActionResult = { ok: true; pairing?: true } | { ok: false; reason: string };

export interface RemoteConnectApi {
  getState: () => Promise<RemoteConnectState>;
  probe: (url: string) => Promise<RemoteProbeResult>;
  connect: (url: string) => Promise<void>;
  useLocal: () => Promise<void>;
  forget: (url: string) => Promise<RecentRemote[]>;
  close: () => void;
  /** Paired + discovered + recent servers (main-process; trusted windows only). */
  listServers: () => Promise<ServersState>;
  /** Live updates; returns an unsubscribe function. */
  onServersChanged: (cb: (state: ServersState) => void) => () => void;
  /** Open (or focus) a paired server's window. */
  openServer: (fingerprint: string) => Promise<ServerActionResult>;
  /** Connect a discovered server (pairing flow when no credential), by list key. */
  connectServer: (key: string) => Promise<ServerActionResult>;
  /** Manual URL: pair on first use and open in a window — no mode change, no relaunch. */
  openInWindow: (url: string) => Promise<ServerActionResult>;
  forgetServer: (fingerprint: string) => Promise<{ ok: boolean; message: string }>;
  pairAgain: (fingerprint: string) => Promise<ServerActionResult>;
}

const remoteConnect: RemoteConnectApi = {
  getState: () => ipcRenderer.invoke("remote-connect:get-state"),
  probe: (url) => ipcRenderer.invoke("remote-connect:probe", url),
  connect: (url) => ipcRenderer.invoke("remote-connect:connect", url),
  useLocal: () => ipcRenderer.invoke("remote-connect:use-local"),
  forget: (url) => ipcRenderer.invoke("remote-connect:forget", url),
  close: () => ipcRenderer.send("remote-connect:close"),
  listServers: () => ipcRenderer.invoke("servers:list"),
  onServersChanged: (cb) => {
    const listener = (_e: unknown, state: ServersState) => cb(state);
    ipcRenderer.on("servers:changed", listener);
    return () => {
      ipcRenderer.removeListener("servers:changed", listener);
    };
  },
  openServer: (fingerprint) => ipcRenderer.invoke("servers:open", { fingerprint }),
  connectServer: (key) => ipcRenderer.invoke("servers:connect", { key }),
  openInWindow: (url) => ipcRenderer.invoke("servers:connect-manual", { url }),
  forgetServer: (fingerprint) => ipcRenderer.invoke("servers:forget", { fingerprint }),
  pairAgain: (fingerprint) => ipcRenderer.invoke("servers:pair-again", { fingerprint }),
};

contextBridge.exposeInMainWorld("remoteConnect", remoteConnect);

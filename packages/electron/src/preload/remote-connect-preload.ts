/**
 * Remote-connect preload bridge. Exposes `window.remoteConnect` to the
 * `remote-connect.html` renderer.
 *
 * Side-effect imported once from `packages/electron/src/preload.ts` so the
 * single bundled preload registers this namespace alongside the piDashboard
 * and doctor bridges.
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

export interface RemoteConnectApi {
  getState: () => Promise<RemoteConnectState>;
  probe: (url: string) => Promise<RemoteProbeResult>;
  connect: (url: string) => Promise<void>;
  useLocal: () => Promise<void>;
  forget: (url: string) => Promise<RecentRemote[]>;
  close: () => void;
}

const remoteConnect: RemoteConnectApi = {
  getState: () => ipcRenderer.invoke("remote-connect:get-state"),
  probe: (url) => ipcRenderer.invoke("remote-connect:probe", url),
  connect: (url) => ipcRenderer.invoke("remote-connect:connect", url),
  useLocal: () => ipcRenderer.invoke("remote-connect:use-local"),
  forget: (url) => ipcRenderer.invoke("remote-connect:forget", url),
  close: () => ipcRenderer.send("remote-connect:close"),
};

contextBridge.exposeInMainWorld("remoteConnect", remoteConnect);

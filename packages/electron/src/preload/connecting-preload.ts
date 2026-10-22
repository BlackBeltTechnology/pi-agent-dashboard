/**
 * Connecting-window preload bridge. Exposes `window.connecting` to the bundled
 * `connecting.html` renderer ONLY (side-effect imported from `preload.ts`, the
 * wizard bundle for trusted `file://` windows). The main process additionally
 * validates `event.senderFrame` for every `servers:*` channel it receives.
 *
 * Carries pairing progress (incl. the confirmation code) — it must never be
 * attached to a window that loads remote content.
 *
 * See change: add-electron-server-windows (D9, D11), group-servers-by-identity (D8).
 */
import { contextBridge, ipcRenderer } from "electron";

export interface ConnectingApi {
  /** Initial state (main replies with the current phase). */
  ready: () => Promise<unknown>;
  onState: (cb: (state: unknown) => void) => () => void;
  sendRequest: (deviceName: string) => Promise<void>;
  stopWaiting: () => Promise<void>;
  pairAgain: () => Promise<void>;
  /** Code mode: the pasted pairing text (goes to main only). */
  submitCode: (text: string) => Promise<void>;
  close: () => void;
}

const connecting: ConnectingApi = {
  ready: () => ipcRenderer.invoke("servers:connecting-ready"),
  onState: (cb) => {
    const listener = (_e: unknown, state: unknown) => cb(state);
    ipcRenderer.on("servers:connecting-state", listener);
    return () => {
      ipcRenderer.removeListener("servers:connecting-state", listener);
    };
  },
  sendRequest: (deviceName) => ipcRenderer.invoke("servers:send-request", { deviceName }),
  stopWaiting: () => ipcRenderer.invoke("servers:stop-waiting"),
  pairAgain: () => ipcRenderer.invoke("servers:pair-again"),
  submitCode: (text) => ipcRenderer.invoke("servers:submit-code", { text }),
  close: () => ipcRenderer.send("servers:connecting-close"),
};

contextBridge.exposeInMainWorld("connecting", connecting);

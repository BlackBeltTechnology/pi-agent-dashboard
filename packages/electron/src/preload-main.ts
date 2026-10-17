/**
 * Minimal preload for the MAIN window (loading page + dashboard, local or
 * remote). Exposes ONLY `window.piDashboard`; it deliberately does NOT import
 * the wizard bridges (`doctor-preload`, `remote-connect-preload`) because in
 * remote mode this window loads untrusted remote content. Privileged
 * `dashboard:*` handlers additionally validate `event.senderFrame`
 * (`lib/ipc-trust.ts`). See change: harden-electron-renderer-boundary (VD5).
 */
import { BROWSER_HOST_CHANNELS as CH, type BrowserHostBridge } from "@blackbelt-technology/pi-dashboard-shared/browser-host-ipc.js";
import { contextBridge, ipcRenderer } from "electron";

// ── piDashboard API ───────────────────────────────────────────────────────────────────
// User-initiated server-launch controls used by the loading page (and any
// future in-app retry control). See change: electron-server-launch-controls.
// Attached to the main window only (wizard windows use `preload.ts`).

export interface PiDashboardLaunchOutcome {
  kind: "already-running" | "started" | "failed";
  url?: string;
  reason?: string;
  logTail?: string;
}

export interface PiDashboardLaunchStatus {
  phase: "starting" | "shutting-down-existing" | "spawning" | "waiting-health" | "ready" | "failed";
  message?: string;
  url?: string;
}

export interface PiDashboardProbeResult {
  ok: boolean;
  version?: string;
  reason?: string;
}

export interface PiDashboardApi {
  requestLaunch: (force?: boolean) => Promise<PiDashboardLaunchOutcome>;
  openDoctor: () => void;
  readServerLog: (lines?: number) => Promise<string>;
  onStatus: (cb: (status: PiDashboardLaunchStatus) => void) => () => void;
  /**
   * Main-process reachability probe (Node fetch, no browser Origin, not CORS-
   * bound). Used by the loading page to decide when to navigate to a remote
   * dashboard whose CORS policy refuses the loading page's `null` origin.
   * See change: fix-remote-connect-cors-gates.
   */
  probeServer: (url: string) => Promise<PiDashboardProbeResult>;
  /**
   * Whole-app (electron-updater) check, from Settings → Dashboard runtime when
   * a runtime requires a newer app. See change: electron-runtime-overlay-updates.
   */
  checkAppUpdate: () => Promise<void>;
  /**
   * Ask the app to open (or focus) the window for a known remote dashboard, or
   * start pairing with it. Present ONLY while this document is on the local
   * dashboard origin (passed by main as `--pi-local-origin=`); a remote-mode
   * document never sees it. The host/port must match a discovered server or a
   * keyring host — main validates and resolves everything else.
   * See change: add-electron-server-windows (D9).
   */
  openServerWindow?: (target: { host: string; port: number }) => Promise<{ ok: true; pairing?: true } | { ok: false; reason: string }>;
  /**
   * Operator browser-host bridge (carrier ↔ Electron main). Present ONLY while
   * this document is on the local dashboard origin — same gate as
   * `openServerWindow`; a remote-origin document never sees it and the main-side
   * channels refuse it anyway (`lib/ipc-trust.ts`). Narrow by design: no private
   * key and no token is ever returned. See change: add-operator-browser-relay (D1, D9).
   */
  browserHost?: BrowserHostBridge;
}

/** Local dashboard origin handed over by the main process via `additionalArguments`. */
const LOCAL_ORIGIN_ARG = "--pi-local-origin=";
function localOriginFromArgv(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(LOCAL_ORIGIN_ARG));
  return arg ? arg.slice(LOCAL_ORIGIN_ARG.length) : undefined;
}

const piDashboard: PiDashboardApi = {
  requestLaunch: (force) => ipcRenderer.invoke("dashboard:request-launch", { force: !!force }),
  openDoctor: () => ipcRenderer.send("dashboard:open-doctor"),
  readServerLog: (lines) => ipcRenderer.invoke("dashboard:read-server-log", { lines: lines ?? 20 }),
  probeServer: (url) => ipcRenderer.invoke("dashboard:probe-server", { url }),
  checkAppUpdate: () => ipcRenderer.invoke("dashboard:check-app-update"),
  onStatus: (cb) => {
    const listener = (_e: unknown, payload: PiDashboardLaunchStatus) => cb(payload);
    ipcRenderer.on("dashboard:launch-status", listener);
    return () => { ipcRenderer.removeListener("dashboard:launch-status", listener); };
  },
};

/** Subscribe to a main → renderer push; returns the unsubscribe. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
}

/** Explicit field copies: nothing but the contract's fields crosses to main. */
const browserHost: BrowserHostBridge = {
  identity: () => ipcRenderer.invoke(CH.identity),
  sign: (nonce, serverId) => ipcRenderer.invoke(CH.sign, nonce, serverId),
  setTarget: (origin) => ipcRenderer.invoke(CH.setTarget, origin),
  connect: (req) => ipcRenderer.invoke(CH.connect, {
    requestId: req?.requestId, linkId: req?.linkId, instanceId: req?.instanceId,
    profileDirectory: req?.profileDirectory, serverLabel: req?.serverLabel,
  }),
  onConnect: (cb) => subscribe(CH.connectAnswer, cb),
  cancelConnect: (requestId) => ipcRenderer.invoke(CH.cancelConnect, requestId),
  extSend: (linkId, data) => { ipcRenderer.send(CH.extSend, linkId, data); return Promise.resolve(); },
  extClose: (linkId, code) => { ipcRenderer.send(CH.extClose, linkId, code); return Promise.resolve(); },
  onExt: (cb) => subscribe(CH.extEvent, cb),
  tee: (linkId, instanceId, tabId, on) => { ipcRenderer.send(CH.tee, linkId, instanceId, tabId, on); return Promise.resolve(); },
  onFrame: (cb) => subscribe(CH.frame, cb),
  setToken: (profileDirectory, token) => ipcRenderer.invoke(CH.setToken, profileDirectory, token),
  listConsents: () => ipcRenderer.invoke(CH.listConsents),
  revokeConsent: (key) => ipcRenderer.invoke(CH.revokeConsent, key),
};

const localOrigin = localOriginFromArgv();
if (localOrigin && globalThis.location?.origin === localOrigin) {
  piDashboard.openServerWindow = (target) => ipcRenderer.invoke("servers:open-from-dashboard", { host: target?.host, port: target?.port });
  piDashboard.browserHost = browserHost;
}

contextBridge.exposeInMainWorld("piDashboard", piDashboard);

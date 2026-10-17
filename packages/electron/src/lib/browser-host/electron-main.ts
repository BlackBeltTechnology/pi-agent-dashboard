/**
 * Electron wiring for the operator browser host: binds the Electron-free
 * `createBrowserHost` to `ipcMain`, `safeStorage`, `dialog` (closable via
 * `signal`), `app.getPath("userData")` and the shared safe `spawn`; installs the
 * "Browser relay → Revoke all" menu hook. `main.ts` calls `startBrowserHost`
 * once and `attachWindow(mainWindow)` for every main window it creates.
 *
 * All logic lives in `ipc.ts` / `identity.ts` / `shim.ts` / `consent.ts` /
 * `tokens.ts` / `tee.ts`; this file only binds them to Electron objects.
 *
 * See change: add-operator-browser-relay (D1, D7, D9).
 */
import os from "node:os";
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import type { SenderEventLike } from "../ipc-trust.js";
import { setRevokeAllHook } from "./consent.js";
import { createChromePort } from "./identity.js";
import { type BrowserHost, createBrowserHost, type IpcMainPort } from "./ipc.js";

export interface BrowserHostMainOptions {
  getMainWindow: () => BrowserWindow | null;
  /** Sender-frame trust: the local loading page or the loopback origin on the configured port. */
  isTrustedSender: (event: SenderEventLike) => boolean;
  log: (line: string) => void;
}

export function startBrowserHost(opts: BrowserHostMainOptions): BrowserHost {
  const host = createBrowserHost({
    ipcMain: ipcMain as unknown as IpcMainPort,
    isTrustedSender: opts.isTrustedSender,
    dir: app.getPath("userData"),
    crypto: safeStorage,
    platform: process.platform,
    hostLabel: () => os.hostname(),
    chrome: createChromePort(),
    dialog: {
      show: async (o, signal) => {
        const parent = opts.getMainWindow();
        const options = { type: "question" as const, title: "Browser relay", noLink: true, signal, ...o };
        const { response } = parent && !parent.isDestroyed() ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
        return response;
      },
    },
    launch: (cmd, args) => {
      // Detached fire-and-forget (Chrome outlives the request); a failed launch surfaces as the
      // server's handshake timeout, same as the dashboard-host path.
      const child = spawn(cmd, args, { windowsHide: true, detached: true, shell: false, stdio: "ignore" });
      child.on("error", (e: Error) => opts.log(`[browser-host] chrome launch error: ${e.message}`));
      child.unref();
    },
    log: opts.log,
  });

  setRevokeAllHook(() => {
    const n = host.revokeAll();
    dialog
      .showMessageBox({
        type: "info",
        title: "Browser relay",
        message: n > 0 ? "Stored browser-relay consents removed" : "No stored browser-relay consents",
        detail: n > 0 ? "The next agent connect to each profile will ask again. Instances that are already connected stay open." : undefined,
        buttons: ["OK"],
      })
      .catch(() => {});
  });
  return host;
}

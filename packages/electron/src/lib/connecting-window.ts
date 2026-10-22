/**
 * App-owned "Connecting to ‹name›" window. Loads ONLY the bundled
 * `renderer/connecting.html` (never remote content) with the wizard preload
 * (`window.connecting`). It is the only window that ever sees the knock
 * confirmation code.
 *
 * The first state is delivered via `servers:connecting-ready` once the page is up.
 *
 * Thin Electron wrapper — the pairing state machine lives in `pairing-client.ts`
 * and the lifecycle in `server-windows.ts`.
 *
 * It also hosts the in-app "Pair with code" (`mode: "code"` states): the pairing text is
 * pasted into THIS bundled page and goes to main over `servers:submit-code`, never through
 * the dashboard page.
 *
 * See change: add-electron-server-windows (D11), group-servers-by-identity (D8).
 */
import { BrowserWindow } from "electron";
import type { ConnectingState } from "./pairing-client.js";
import { getRendererHtmlPath, getWizardPreloadPath } from "./renderer-paths.js";
import type { ConnectingHandle } from "./server-windows.js";

export const CONNECTING_HTML = "connecting.html";

let current: BrowserWindow | null = null;

/** The live connecting window (for the IPC sender check), or null. */
export function getConnectingWindow(): BrowserWindow | null {
  return current && !current.isDestroyed() ? current : null;
}

/** Open the connecting window; `onClosed` fires when the user closes it (stop any pairing). */
export function openConnectingWindow(onClosed: () => void, initial?: Pick<ConnectingState, "mode">): ConnectingHandle {
  const win = new BrowserWindow({
    width: 500,
    height: 560,
    resizable: false,
    minimizable: false,
    title: initial?.mode === "code" ? "Pair with code — PI Dashboard" : "Connecting — PI Dashboard",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: getWizardPreloadPath(),
    },
  });
  current = win;
  // Bundled content only: this window carries the pairing bridge, so it never navigates or opens windows.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.loadFile(getRendererHtmlPath(CONNECTING_HTML)).catch((err: unknown) => {
    console.error(`[server-windows] connecting window failed to load: ${err instanceof Error ? err.message : String(err)}`);
  });
  win.on("closed", () => {
    if (current === win) current = null;
    onClosed();
  });
  return {
    push(state) {
      if (!win.isDestroyed()) win.webContents.send("servers:connecting-state", state);
    },
    focus() {
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.focus();
    },
    close() {
      if (!win.isDestroyed()) win.close();
    },
    isOpen: () => !win.isDestroyed(),
  };
}

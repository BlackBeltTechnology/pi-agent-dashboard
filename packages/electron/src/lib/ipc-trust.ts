/**
 * Sender-frame trust for privileged `dashboard:*` IPC handlers.
 *
 * In remote mode the main window loads untrusted remote content with the
 * `piDashboard` preload attached, so the main process must not assume that a
 * caller of `ipcMain.handle` is our own UI. A call is trusted only when its
 * `senderFrame.url` is (a) the local `loading.html` file, or (b) the LOCAL
 * dashboard origin (loopback host on the configured port). The remote/tunnel
 * origin is deliberately NOT trusted.
 *
 * Imports nothing from electron — unit-tested in `__tests__/ipc-trust.test.ts`.
 *
 * See change: harden-electron-renderer-boundary (VD5).
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

export interface TrustContext {
  /** Absolute filesystem path of the shipped `loading.html`. */
  loadingPagePath: string;
  /** Port of the locally managed dashboard server. */
  localPort: number;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isTrustedSenderUrl(senderUrl: unknown, ctx: TrustContext): boolean {
  if (typeof senderUrl !== "string" || !senderUrl) return false;
  let u: URL;
  try {
    u = new URL(senderUrl);
  } catch {
    return false;
  }
  if (u.protocol === "file:") {
    try {
      return path.resolve(fileURLToPath(u)) === path.resolve(ctx.loadingPagePath);
    } catch {
      return false;
    }
  }
  if (u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname)) {
    return Number(u.port || 80) === ctx.localPort;
  }
  return false;
}

/** Minimal shape of an Electron `IpcMainEvent | IpcMainInvokeEvent`. */
export interface SenderEventLike {
  senderFrame?: { url?: string } | null;
}

export class UntrustedSenderError extends Error {
  constructor(channel: string) {
    super(`IPC ${channel} rejected: untrusted sender frame`);
    this.name = "UntrustedSenderError";
  }
}

/**
 * Wrap an `ipcMain.handle` handler: untrusted callers get a rejected promise
 * (`UntrustedSenderError`) and no privileged action runs.
 */
export function trustedHandler<E extends SenderEventLike, A extends unknown[], R>(
  channel: string,
  isTrusted: (event: E) => boolean,
  handler: (event: E, ...args: A) => R,
  onReject?: (channel: string, event: E) => void,
): (event: E, ...args: A) => R {
  return (event, ...args) => {
    if (!isTrusted(event)) {
      onReject?.(channel, event);
      throw new UntrustedSenderError(channel);
    }
    return handler(event, ...args);
  };
}

/**
 * Wrap an `ipcMain.on` listener: untrusted calls are dropped silently (a throw
 * inside an `on` listener would surface as an uncaught main-process exception).
 */
export function trustedListener<E extends SenderEventLike, A extends unknown[]>(
  channel: string,
  isTrusted: (event: E) => boolean,
  listener: (event: E, ...args: A) => void,
  onReject?: (channel: string, event: E) => void,
): (event: E, ...args: A) => void {
  return (event, ...args) => {
    if (!isTrusted(event)) {
      onReject?.(channel, event);
      return;
    }
    listener(event, ...args);
  };
}

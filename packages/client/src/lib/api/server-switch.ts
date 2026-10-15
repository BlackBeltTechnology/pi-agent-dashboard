/**
 * Transactional server-switch coordinator.
 *
 * Extracted from `App.tsx` so the ordering guarantees — staging-open BEFORE
 * state clear BEFORE `setWsUrl` BEFORE localStorage persistence — are
 * unit-testable without mounting the whole app.
 *
 * See change: safe-server-switch.
 */
import { getOpenServerWindow } from "../electron-server-windows.js";
import { openStagingSocket } from "./staging-socket.js";

/** localStorage key holding the last-used server (`host:port`). */
export const LAST_SERVER_KEY = "pi-dashboard-last-server";

/**
 * Initial WebSocket URL: the saved last-used server, else this page's own origin.
 * In the Electron local window (open-server-window capability present) a saved
 * remote is IGNORED — not deleted, so a revert restores the old behaviour — so
 * an upgrade from an earlier in-page switch cannot pull the local window onto a
 * remote. See change: add-electron-server-windows (D13).
 */
export function getInitialWsUrl(): string {
  const loc = window.location;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const own = `${proto}//${loc.hostname}${loc.port ? `:${loc.port}` : ""}/ws`;
  if (getOpenServerWindow()) return own;
  const saved = localStorage.getItem(LAST_SERVER_KEY);
  if (saved) {
    const [host, port] = saved.split(":");
    if (host && port) return `${proto}//${host}:${port}/ws`;
  }
  return own;
}

export interface ServerSwitchTarget {
  host: string;
  port: number;
  /** "ws:" or "wss:". Captured from `window.location.protocol` at call site. */
  wsProtocol: "ws:" | "wss:";
}

export interface ServerSwitchDeps {
  /** Injectable so tests can control timing without real sockets. */
  openStagingSocket: (
    url: string,
    opts: { timeoutMs: number },
  ) => Promise<WebSocket>;
  /** Called AFTER staging resolves, BEFORE setWsUrl. Wipes in-memory state. */
  clearInMemoryState: () => void;
  /** Triggers React's WebSocket hook to reconnect to the new URL. */
  setWsUrl: (url: string) => void;
  /** Writes to localStorage. Called ONLY after a successful switch. */
  persistLastServer: (host: string, port: number) => void;
  /** User-visible error surface on failure. */
  notifyError: (message: string) => void;
}

export interface ServerSwitchResult {
  ok: boolean;
  error?: string;
}

/** 5-second budget — see design.md Decision 2. */
const STAGING_TIMEOUT_MS = 5000;

export async function performServerSwitch(
  target: ServerSwitchTarget,
  deps: ServerSwitchDeps,
): Promise<ServerSwitchResult> {
  const url = `${target.wsProtocol}//${target.host}:${target.port}/ws`;
  let stagingWs: WebSocket;
  try {
    stagingWs = await deps.openStagingSocket(url, {
      timeoutMs: STAGING_TIMEOUT_MS,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    deps.notifyError(`Couldn't reach ${target.host}: ${reason}`);
    return { ok: false, error: reason };
  }

  // Staging opened: we know the target is reachable.
  // Close staging first — the useWebSocket hook will open its own connection.
  try {
    stagingWs.close();
  } catch {
    // ignore
  }

  // Commit: clear state, flip WS URL, then persist localStorage.
  // Ordering matters — see design.md Decision 3.
  deps.clearInMemoryState();
  deps.setWsUrl(url);
  deps.persistLastServer(target.host, target.port);
  return { ok: true };
}

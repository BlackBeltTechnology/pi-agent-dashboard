/**
 * Auto-shutdown idle timer with sleep-wake resilience.
 * Shuts down the server when no pi sessions are connected for the configured idle period.
 */
import type { PiGateway } from "../pi/pi-gateway.js";
import type { ServerConfig } from "../server.js";

export interface IdleTimer {
  start(): void;
  cancel(): void;
  /** Set the stop callback (must be set before starting) */
  setStopFn(fn: () => Promise<void>): void;
}

/**
 * Predicate that returns true when one or more terminal PTYs are alive.
 * The idle timer SHALL NOT shut down while terminals are active — a user
 * with a long-running command (cargo build, tail -f, etc.) and no
 * attached agent still expects the server to stay up.
 * See change: fix-terminal-half-height-dual-mount.
 */
export type HasActiveTerminals = () => boolean;

export function createIdleTimer(
  config: ServerConfig,
  piGateway: PiGateway,
  hasActiveTerminals: HasActiveTerminals = () => false,
): IdleTimer {
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let stopServer: (() => Promise<void>) | null = null;
  let lastConnectionTimestamp = 0;

  function start() {
    if (!config.autoShutdown) return;
    cancel();
    idleTimer = setTimeout(async () => {
      const realIdleMs = Date.now() - lastConnectionTimestamp;
      if (
        piGateway.connectionCount() > 0 ||
        realIdleMs < config.shutdownIdleSeconds * 1000 ||
        hasActiveTerminals()
      ) {
        start();
        return;
      }
      console.log(`No pi sessions for ${config.shutdownIdleSeconds}s, shutting down...`);
      await stopServer?.();
      process.exit(0);
    }, config.shutdownIdleSeconds * 1000);
  }

  function cancel() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  piGateway.onEmpty = () => {
    start();
  };

  piGateway.onConnection = () => {
    lastConnectionTimestamp = Date.now();
    cancel();
  };

  return {
    start,
    cancel,
    setStopFn(fn: () => Promise<void>) {
      stopServer = fn;
    },
  };
}

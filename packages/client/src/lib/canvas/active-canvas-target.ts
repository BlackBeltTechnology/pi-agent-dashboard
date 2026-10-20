/**
 * The loopback port of a session's ACTIVE canvas target (the declared server /
 * loopback URL chip), published by `CanvasDriver` so the live-server picker can
 * list it first (change: improve-canvas-html-and-url-ux, D9). A tiny external
 * store: the picker lives deep in the editor pane, far from the driver.
 */
import { useSyncExternalStore } from "react";

const ports = new Map<string, number>();
const listeners = new Set<() => void>();

/** Publish (or clear, `null`) the active canvas port of a session. */
export function setActiveCanvasPort(sessionId: string, port: number | null): void {
  if (port == null ? !ports.has(sessionId) : ports.get(sessionId) === port) return;
  if (port == null) ports.delete(sessionId);
  else ports.set(sessionId, port);
  for (const l of [...listeners]) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useActiveCanvasPort(sessionId: string | undefined): number | null {
  return useSyncExternalStore(
    subscribe,
    () => (sessionId ? (ports.get(sessionId) ?? null) : null),
    () => null,
  );
}

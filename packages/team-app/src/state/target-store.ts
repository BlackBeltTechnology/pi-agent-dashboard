/**
 * The selected target (project id or own workspace). A tiny app store, not
 * router state, so `HeaderContext` works even when the host renders it outside
 * the app's `Router` (D16). Persisted under `team:target`.
 * See change: add-team-plugin.
 */
import { useSyncExternalStore } from "react";
import type { ProjectInfo, Target } from "../api/types.js";
import { WORKSPACE } from "../api/types.js";

const KEY = "team:target";
let current: Target | null = null;
const listeners = new Set<() => void>();

function read(): Target | null {
  if (current !== null) return current;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export const targetStore = {
  get: read,
  set(t: Target): void {
    if (read() === t) return;
    current = t;
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* memory only */
    }
    for (const l of listeners) l();
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  /** Test-only. */
  reset(): void {
    current = null;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    for (const l of listeners) l();
  },
};

/** Start target: last selected (if still usable) → first available project → own workspace (D10). */
export function resolveStartTarget(stored: Target | null, projects: ProjectInfo[]): Target {
  const usable = (id: string) => id === WORKSPACE || projects.some((p) => p.id === id && p.available);
  if (stored && usable(stored)) return stored;
  const first = projects.find((p) => p.available);
  return first ? first.id : WORKSPACE;
}

export function useStoredTarget(): Target | null {
  return useSyncExternalStore(targetStore.subscribe, targetStore.get, targetStore.get);
}

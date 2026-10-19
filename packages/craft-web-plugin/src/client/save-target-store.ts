/**
 * Save-target choice (`overwrite` default | `copy`), keyed by file (`cwd` + `path`) so
 * every tab/instance on the same file agrees (design D4). Module-level so it also
 * survives a handler remount.
 * See change: edit-office-in-pane-with-craft-web.
 */
import { useSyncExternalStore } from "react";

export type SaveTarget = "overwrite" | "copy";

const targets = new Map<string, SaveTarget>();
const listeners = new Set<() => void>();

export const saveTargetKey = (cwd: string, path: string): string => `${cwd}\u0000${path}`;

export function getSaveTarget(key: string): SaveTarget {
  return targets.get(key) ?? "overwrite";
}

export function setSaveTarget(key: string, target: SaveTarget): void {
  if (getSaveTarget(key) === target) return;
  targets.set(key, target);
  for (const l of [...listeners]) l();
}

export function useSaveTarget(key: string): SaveTarget {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => getSaveTarget(key),
    () => getSaveTarget(key),
  );
}

export function __resetSaveTargetsForTests(): void {
  targets.clear();
}

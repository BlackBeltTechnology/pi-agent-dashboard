/**
 * Per-browser "Show plugin internals" preference.
 *
 * Plugin slot claims are developer data: the host chrome shows them only when
 * this flag is on. Stored in `localStorage` (default off) — view-only aid, so
 * deliberately NOT a dashboard config key and never written to `/api/config`.
 * Best-effort read/write (disabled storage → off).
 *
 * See change: retro-ux-plugin-settings-wave-2 (design D5).
 */

import { useSyncExternalStore } from "react";

export const PLUGIN_INTERNALS_KEY = "pi-dashboard:show-plugin-internals";

const listeners = new Set<() => void>();

/** Read the preference; `false` on absence or unavailable storage. */
export function loadShowPluginInternals(): boolean {
  try {
    return globalThis.localStorage?.getItem(PLUGIN_INTERNALS_KEY) === "true";
  } catch {
    return false;
  }
}

/** Persist the preference and notify mounted readers. */
export function saveShowPluginInternals(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(PLUGIN_INTERNALS_KEY, String(on));
  } catch (err) {
    console.warn("[plugin-internals-pref] failed to persist preference", err);
  }
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  // Another tab flipping the flag.
  const onStorage = (e: StorageEvent) => {
    if (e.key === PLUGIN_INTERNALS_KEY || e.key === null) notify();
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => {
    listeners.delete(notify);
    globalThis.removeEventListener?.("storage", onStorage);
  };
}

/** `[on, setOn]` — reactive across components and tabs. */
export function useShowPluginInternals(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, loadShowPluginInternals, () => false);
  return [on, saveShowPluginInternals];
}

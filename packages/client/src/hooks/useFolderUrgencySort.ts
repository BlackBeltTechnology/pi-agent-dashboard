/**
 * Per-folder "urgency sort" preference (default OFF, opt-in). When ON for a
 * folder, its active session list floats chat-routed `ask_user` (blocked-on-you)
 * sessions to the top. Persisted in localStorage keyed by folder cwd — a
 * pure-client pref, mirroring the sidebar's other view-state toggles
 * (collapse / ended-expanded). No server round-trip.
 *
 * See change: improve-dashboard-attention-routing.
 */
import { useCallback, useState } from "react";

export const FOLDER_URGENCY_SORT_KEY = "dashboard:folder-urgency-sort";

function readStored(): Set<string> {
  try {
    const raw = localStorage.getItem(FOLDER_URGENCY_SORT_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === "string"));
    }
  } catch {
    /* noop */
  }
  return new Set();
}

function persist(set: Set<string>): void {
  try {
    localStorage.setItem(FOLDER_URGENCY_SORT_KEY, JSON.stringify([...set]));
  } catch {
    /* noop */
  }
}

export interface FolderUrgencySortState {
  /** True when urgency sort is enabled for the given folder cwd. */
  isOn: (cwd: string) => boolean;
  /** Toggle urgency sort for a folder cwd (persisted). */
  toggle: (cwd: string) => void;
}

export function useFolderUrgencySort(): FolderUrgencySortState {
  const [set, setSet] = useState<Set<string>>(readStored);

  const toggle = useCallback((cwd: string) => {
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      persist(next);
      return next;
    });
  }, []);

  const isOn = useCallback((cwd: string) => set.has(cwd), [set]);

  return { isOn, toggle };
}

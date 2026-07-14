/**
 * Per-cwd git-status cache for the on-demand half of the hybrid delivery.
 *
 * Keyed by cwd (NOT session), so a folder header and a solo card at the same
 * path share ONE entry — no per-session redundancy. Components read via
 * `useGitStatus(cwd, fallback)`; the passive broadcast (`session.gitStatus`)
 * is the fallback, and an on-demand `refreshGitStatus(cwd)` (on focus/expand +
 * post-commit) overrides it with a fresh read.
 *
 * See change: add-session-uncommitted-indicator-and-commit.
 */

import type { GitStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useSyncExternalStore } from "react";
import { fetchGitStatus } from "./git-api.js";

const cache = new Map<string, GitStatus>();
const listeners = new Map<string, Set<() => void>>();

function notify(cwd: string) {
  listeners.get(cwd)?.forEach((fn) => fn());
}

export function setCachedGitStatus(cwd: string, status: GitStatus) {
  cache.set(cwd, status);
  notify(cwd);
}

export function getCachedGitStatus(cwd: string): GitStatus | undefined {
  return cache.get(cwd);
}

/** Fetch fresh status and update the cache. Best-effort (null → no update). */
export async function refreshGitStatus(cwd: string): Promise<void> {
  const s = await fetchGitStatus(cwd);
  if (s) setCachedGitStatus(cwd, s);
}

/**
 * Subscribe to a cwd's cached status. Returns the fresh cache value if present,
 * else `fallback` (the broadcast `session.gitStatus`). The on-demand read wins
 * because it is strictly newer than the last broadcast tick.
 */
export function useGitStatus(cwd: string, fallback: GitStatus | undefined): GitStatus | undefined {
  const subscribe = (onChange: () => void) => {
    let set = listeners.get(cwd);
    if (!set) { set = new Set(); listeners.set(cwd, set); }
    set.add(onChange);
    return () => {
      set?.delete(onChange);
      if (set && set.size === 0) listeners.delete(cwd);
    };
  };
  const cached = useSyncExternalStore(subscribe, () => cache.get(cwd));
  return cached ?? fallback;
}

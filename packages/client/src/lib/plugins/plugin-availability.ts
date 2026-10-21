/**
 * `pluginAvailability` — module store of plugin availability, read at RENDER
 * time to decide how an owned-event group row shows.
 *
 * Availability = the server reports the plugin `enabled`, `loaded` and its
 * client not refused. It arrives after the first replay and changes later
 * (toggle, failed load, trust revoke), so the pure event reducer never reads
 * it (design D5 / R8): a replay that runs before `/api/health` answers cannot
 * collapse an enabled plugin permanently. A change re-renders subscribers; it
 * never re-reduces.
 *
 * Fed by `usePluginEnabledSet` from `/api/health.plugins[]`.
 * See change: decouple-plugins-from-core (task 2.16).
 */
import { useSyncExternalStore } from "react";

/** The subset of `/api/health.plugins[]` entries this store reads. */
export interface PluginStatusLike {
  id: string;
  enabled?: boolean;
  loaded?: boolean;
  /** Runtime-client admission (`PluginStatus.client`); `"refused"` = unavailable. */
  client?: { delivery?: string };
}

/** Immutable view of one status read; a new object per change so hooks re-render. */
export interface PluginAvailabilitySnapshot {
  /**
   * True only when a status read happened AND it lists the plugin as
   * unavailable. Before the first read, or for an id the server does not list
   * (default-allow, like the enabled set), the plugin counts as available.
   */
  isUnavailable(id: string): boolean;
}

function makeSnapshot(table: ReadonlyMap<string, boolean> | null): PluginAvailabilitySnapshot {
  return { isUnavailable: (id) => table?.get(id) === false };
}

// `null` table = no status read yet. id → available once read.
let statuses: ReadonlyMap<string, boolean> | null = null;
let snapshot: PluginAvailabilitySnapshot = makeSnapshot(null);
const listeners = new Set<() => void>();

function isAvailable(p: PluginStatusLike): boolean {
  return p.enabled !== false && p.loaded !== false && p.client?.delivery !== "refused";
}

/** Replace the status table from a fresh `/api/health.plugins[]` read. */
export function applyPluginStatuses(plugins: readonly PluginStatusLike[]): void {
  const next = new Map<string, boolean>();
  for (const p of plugins) next.set(p.id, isAvailable(p));
  const changed =
    statuses === null ||
    next.size !== statuses.size ||
    [...next].some(([id, ok]) => statuses?.get(id) !== ok);
  if (!changed) return;
  statuses = next;
  snapshot = makeSnapshot(next);
  for (const l of listeners) l();
}

/** See {@link PluginAvailabilitySnapshot.isUnavailable}. */
export function isPluginUnavailable(id: string): boolean {
  return snapshot.isUnavailable(id);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PluginAvailabilitySnapshot {
  return snapshot;
}

/** Subscribe the caller to availability changes; returns the current immutable snapshot. */
export function usePluginAvailability(): PluginAvailabilitySnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Test-only: drop all state and subscribers. */
export function __resetPluginAvailabilityForTests(): void {
  statuses = null;
  snapshot = makeSnapshot(null);
  listeners.clear();
}

/** The store as one handle (`pluginAvailability.apply(...)`, `.isUnavailable(id)`). */
export const pluginAvailability = {
  apply: applyPluginStatuses,
  isUnavailable: isPluginUnavailable,
  use: usePluginAvailability,
  reset: __resetPluginAvailabilityForTests,
} as const;

/**
 * Generic plugin seams with no owner of their own on the server:
 *
 * - the declared replay entry-type sets (`pi-dashboard-plugin.replayEntryTypes`
 *   of discovered plugins), read by every session replay so an OFFLINE session
 *   replays from manifests, not a live bridge;
 * - `/api/health` counters: declared replay types (gauge), replayed plugin
 *   entries (cumulative) and rejected `plugin_action`s (cumulative, bumped by a
 *   plugin through `ctx.recordRejectedAction`).
 *
 * Core names no plugin entry type here. See change: update-flows-plugin (D3, task 1.7).
 */
import type { ReplayEntryTypeSets } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/replay-entry-types.js";

const EMPTY: ReplayEntryTypeSets = { replay: [], hidden: [] };
let provider: () => ReplayEntryTypeSets = () => EMPTY;
let replayedPluginEntries = 0;
let rejectedPluginActions = 0;

/** Install the manifest-derived provider (server boot). */
export function setReplayEntryTypesProvider(fn: () => ReplayEntryTypeSets): void {
  provider = fn;
}

/** Current sets; a throwing provider yields none (replay must never fail on it). */
export function getReplayEntryTypes(): ReplayEntryTypeSets {
  try {
    return provider();
  } catch {
    return EMPTY;
  }
}

export function recordPluginEntriesReplayed(n: number): void {
  if (Number.isFinite(n) && n > 0) replayedPluginEntries += n;
}

export function recordRejectedPluginAction(): void {
  rejectedPluginActions++;
}

export interface PluginEntryStats {
  declaredReplayTypes: number;
  replayedPluginEntries: number;
  rejectedPluginActions: number;
}

export function getPluginEntryStats(): PluginEntryStats {
  return {
    declaredReplayTypes: getReplayEntryTypes().replay.length,
    replayedPluginEntries,
    rejectedPluginActions,
  };
}

/** Test seam. */
export function resetPluginEntryStatsForTest(): void {
  provider = () => EMPTY;
  replayedPluginEntries = 0;
  rejectedPluginActions = 0;
}

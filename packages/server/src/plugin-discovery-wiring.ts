/**
 * Server-side wiring of plugin discovery after boot: `refreshPluginDiscovery()` (additive load
 * of new plugins, restart flags, ONE `plugins_changed`) and local-scope detection for active
 * session cwds. Pure composition of the runtime's `createPluginRefresher` +
 * `createLocalScopeDetector` over the loader deps the boot pass used.
 *
 * See change: decouple-plugins-from-core (tasks 5.5, 5.9).
 */
import {
  createLocalScopeDetector,
  createPluginRefresher,
  getPluginStatusStore,
  type PluginRefresherDeps,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { PluginStatus } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/plugin-status.js";

export interface PluginDiscoveryWiringDeps {
  /** The deps of the boot `loadServerEntries` call. */
  loadDeps: PluginRefresherDeps["loadDeps"];
  /** Re-read the served declaration's `bundledPluginIds` (`undefined` = undeclared). */
  readDeclaredBundledIds: () => readonly string[] | undefined;
  /** Content-hash stat cache hook (task 6.7). */
  clearContentHashCache?: () => void;
  /** Cwds of the active (not ended) sessions, live. */
  listActiveCwds: () => readonly string[];
  /** Broadcast one `plugins_changed` to browsers. */
  broadcastPluginsChanged: (plugins: PluginStatus[]) => void;
}

export interface PluginDiscoveryWiring {
  /** Coalesced: concurrent calls collapse into at most one follow-up run. Always ends in ONE `plugins_changed`. */
  refreshPluginDiscovery(): Promise<void>;
  /**
   * Rerun local-scope detection (e.g. after a successful `--scope local` package op). Broadcasts one
   * `plugins_changed` only when the detected set changed. Returns whether it changed.
   */
  rerunLocalDetection(): boolean;
  /** A session registered: rerun detection only when its cwd was not already scanned. */
  onSessionRegistered(cwd: string): void;
  /** A session ended (already excluded from `listActiveCwds`): rerun detection for the remaining cwds. */
  onSessionEnded(): void;
}

export function createPluginDiscoveryWiring(deps: PluginDiscoveryWiringDeps): PluginDiscoveryWiring {
  let scannedCwds = new Set<string>();
  const detector = createLocalScopeDetector({
    listCwds: () => {
      const cwds = deps.listActiveCwds();
      scannedCwds = new Set(cwds);
      return cwds;
    },
  });
  const refresher = createPluginRefresher({
    loadDeps: deps.loadDeps,
    readDeclaredBundledIds: deps.readDeclaredBundledIds,
    clearContentHashCache: deps.clearContentHashCache,
    localDetector: detector,
    broadcast: deps.broadcastPluginsChanged,
  });

  function rerunLocalDetection(): boolean {
    const changed = detector.rerun();
    if (changed) deps.broadcastPluginsChanged(getPluginStatusStore().listAll());
    return changed;
  }

  return {
    refreshPluginDiscovery: refresher.refreshPluginDiscovery,
    rerunLocalDetection,
    onSessionRegistered(cwd) {
      if (!scannedCwds.has(cwd)) rerunLocalDetection();
    },
    onSessionEnded() {
      rerunLocalDetection();
    },
  };
}

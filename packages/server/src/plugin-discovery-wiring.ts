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
  /**
   * Completion hook of a package operation (after `package_operation_complete` was broadcast).
   * Failed op → nothing. Global scope (or a `move`, which touches both scopes) → one coalesced
   * discovery refresh. Local scope → local-scope detection only, and exactly ONE `plugins_changed`.
   * Resolves when the refresh finished (local: immediately).
   */
  onPackageOperationComplete(result: { success: boolean; scope: string; action?: string }): Promise<void>;
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

  async function onPackageOperationComplete(result: { success: boolean; scope: string; action?: string }): Promise<void> {
    if (!result.success) return;
    if (result.scope === "local" && result.action !== "move") {
      // `rerunLocalDetection` already broadcast when the set changed; otherwise broadcast once anyway.
      if (!rerunLocalDetection()) deps.broadcastPluginsChanged(getPluginStatusStore().listAll());
      return;
    }
    try {
      await refresher.refreshPluginDiscovery();
    } catch (e) {
      console.error("[plugin-loader] refresh after package operation failed:", e);
    }
  }

  return {
    refreshPluginDiscovery: refresher.refreshPluginDiscovery,
    rerunLocalDetection,
    onPackageOperationComplete,
    onSessionRegistered(cwd) {
      if (!scannedCwds.has(cwd)) rerunLocalDetection();
    },
    onSessionEnded() {
      rerunLocalDetection();
    },
  };
}

export interface PackageCompletionDeps<R extends { success: boolean; scope: string; action?: string }> {
  /** Broadcast `package_operation_complete` (always, success or not). */
  broadcastComplete(result: R): void;
  invalidateRecommendedCache(): void;
  /** Late-bound: the wiring exists only after the boot load pass. */
  discovery(): Pick<PluginDiscoveryWiring, "onPackageOperationComplete"> | undefined;
  /** Requirement-probe refresh; runs for every successful op of either scope. */
  refreshProbes(): Promise<void> | void;
}

/**
 * The package-operation completion listener, as one ordered unit: completion broadcast, then (only on
 * success) recommended-cache invalidation, the discovery refresh / local detection (ONE `plugins_changed`)
 * and the requirement-probe refresh. A failed op does nothing past the broadcast.
 *
 * See change: decouple-plugins-from-core (task 5.7, test-plan #E56).
 */
export function createPackageCompletionHandler<R extends { success: boolean; scope: string; action?: string }>(
  deps: PackageCompletionDeps<R>,
): (result: R) => void {
  return (result) => {
    deps.broadcastComplete(result);
    if (!result.success) return;
    deps.invalidateRecommendedCache();
    deps.discovery()?.onPackageOperationComplete(result).catch((e) => {
      console.error("[plugin-loader] discovery after package operation failed:", e);
    });
    void Promise.resolve(deps.refreshProbes()).catch((e) => {
      console.error("[plugin-loader] requirement-probe refresh after package operation failed:", e);
    });
  };
}

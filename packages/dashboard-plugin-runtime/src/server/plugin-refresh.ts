/**
 * `refreshPluginDiscovery()` — pick up plugins installed (or removed) after boot without a
 * server restart. Additive by design (D14): only NEW ids are loaded; an existing id whose
 * package changed or vanished is flagged `restartRequired` and keeps its row.
 *
 * Steps: re-read the served declaration → clear discovery caches → rediscover → flag
 * changed/vanished → additive `loadServerEntries` (new, enabled, hostApi-admitted and, for
 * `pi-package`, server-trusted ids; a throwing entry is recorded `loaded:false` + error) →
 * local-scope detection → ONE `plugins_changed` broadcast. Concurrent calls coalesce: at most
 * one follow-up run however many requests arrive while one is running.
 *
 * See change: decouple-plugins-from-core (tasks 5.4-5.6, design D14/D15).
 */
import type { PluginStatus } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/plugin-status.js";
import {
  clearDiscoveryCache,
  type DiscoveredPlugin,
  discoverForDeps,
  discoveryFields,
  getPluginStatusStore,
  loadedPackageChanged,
  loadServerEntries,
  type ServerLoadDeps,
  setDeclaredBundledPluginIds,
  wasLoadedThisProcess,
} from "./loader.js";
import type { LocalScopeDetector } from "./local-scope-detector.js";

export interface PluginRefresherDeps {
  /** The same deps the boot `loadServerEntries` call used (`onlyIds` / `bundledPluginIds` are set here). */
  loadDeps: Omit<ServerLoadDeps, "onlyIds">;
  /**
   * Re-read the served build declaration's `bundledPluginIds` (`undefined` = undeclared). Absent →
   * the process-wide declared ids are left as they are.
   */
  readDeclaredBundledIds?: () => readonly string[] | undefined;
  /** Hook for the content-hash stat cache (task 6.7); cleared on every refresh. */
  clearContentHashCache?: () => void;
  /** Local-scope detection, rerun on every refresh. */
  localDetector?: Pick<LocalScopeDetector, "rerun">;
  /** Called exactly once per run with the full status list. */
  broadcast: (plugins: PluginStatus[]) => void;
}

export interface PluginRefresher {
  /** Resolves when a run that started AFTER this call finished (coalesced with other callers). */
  refreshPluginDiscovery(): Promise<void>;
}

/**
 * Reconcile the status store with a fresh discovery. Vanished: keep a loaded row
 * (`restartRequired`), drop one whose server entry never loaded. Existing: refresh the
 * discovery-derived fields, flag a changed package. Returns the NEW ids (no row yet).
 */
function reconcileStore(discovered: readonly DiscoveredPlugin[]): Set<string> {
  const store = getPluginStatusStore();
  const discoveredIds = new Set(discovered.map((p) => p.manifest.id));
  // Local-detected rows are owned by the detector; it re-applies after the load pass.
  const rows = store.listAll().filter((r) => r.source !== "local-detected");
  const rowIds = new Set(rows.map((r) => r.id));

  for (const row of rows) {
    if (discoveredIds.has(row.id)) continue;
    if (wasLoadedThisProcess(row.id)) store.setStatus({ ...row, restartRequired: true });
    else store.removeStatus(row.id);
  }

  const newIds = new Set<string>();
  for (const plugin of discovered) {
    const id = plugin.manifest.id;
    const row = rowIds.has(id) ? store.getStatus(id) : undefined;
    if (!row) {
      newIds.add(id);
      continue;
    }
    // Keep the row, refresh its discovery-derived fields (source, shadowed copies); never reload.
    const { shadowed: _stale, source: _src, ...kept } = row;
    store.setStatus({
      ...kept,
      ...discoveryFields(plugin),
      ...(loadedPackageChanged(plugin) ? { restartRequired: true } : {}),
    });
  }
  return newIds;
}

export function createPluginRefresher(deps: PluginRefresherDeps): PluginRefresher {
  let running: Promise<void> | null = null;
  let followUp: Promise<void> | null = null;

  async function run(): Promise<void> {
    const store = getPluginStatusStore();
    if (deps.readDeclaredBundledIds) setDeclaredBundledPluginIds(deps.readDeclaredBundledIds());
    clearDiscoveryCache();
    deps.clearContentHashCache?.();
    const newIds = reconcileStore(discoverForDeps(deps.loadDeps));

    if (newIds.size > 0) {
      try {
        await loadServerEntries({ ...deps.loadDeps, onlyIds: newIds });
      } catch (e) {
        console.error("[plugin-loader] refresh: additive load failed:", e);
      }
    }

    deps.localDetector?.rerun();
    deps.broadcast(store.listAll());
  }

  function refreshPluginDiscovery(): Promise<void> {
    if (!running) {
      running = run().finally(() => {
        running = null;
      });
      return running;
    }
    if (!followUp) {
      followUp = running
        .catch(() => {})
        .then(() => {
          followUp = null;
          return refreshPluginDiscovery();
        });
    }
    return followUp;
  }

  return { refreshPluginDiscovery };
}

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

/** Error text recorded when a hot-added plugin's server entry tried to register Fastify routes after listen. */
export const HOT_ROUTE_RESTART_ERROR =
  "Server entry registers HTTP routes, which cannot be added while the server is running. Restart the dashboard to load this plugin.";

/** Fastify's refusal to add a route/hook/plugin after `listen()` (`FST_ERR_INSTANCE_ALREADY_LISTENING`). */
function isAlreadyListeningError(error: string | undefined): boolean {
  return typeof error === "string" && /already listening|FST_ERR_INSTANCE_ALREADY_LISTENING/i.test(error);
}

/**
 * A refresh runs after Fastify is listening, so a hot-added plugin whose server entry calls
 * `fastify.get(...)` throws. The loader already records that as `loaded:false` + error; make it
 * explicit (a clear error and `restartRequired`) so the Plugins tab shows the restart hint.
 * See change: decouple-plugins-from-core (design D14, Open Questions).
 */
function flagHotRouteFailures(newIds: ReadonlySet<string>): void {
  const store = getPluginStatusStore();
  for (const id of newIds) {
    const row = store.getStatus(id);
    if (row && !row.loaded && isAlreadyListeningError(row.error)) {
      store.setStatus({ ...row, error: HOT_ROUTE_RESTART_ERROR, restartRequired: true });
    }
  }
}

interface ReconcileResult {
  newIds: Set<string>;
  /** Existing rows flagged because their package changed. */
  changed: number;
  /** Rows whose package vanished (kept with `restartRequired` or dropped). */
  removed: number;
}

/**
 * Reconcile the status store with a fresh discovery. Vanished: keep a loaded row
 * (`restartRequired`), drop one whose server entry never loaded. Existing: refresh the
 * discovery-derived fields, flag a changed package. Returns the NEW ids (no row yet) plus change counts.
 */
function reconcileStore(discovered: readonly DiscoveredPlugin[]): ReconcileResult {
  const store = getPluginStatusStore();
  const discoveredIds = new Set(discovered.map((p) => p.manifest.id));
  // Local-detected rows are owned by the detector; it re-applies after the load pass.
  const rows = store.listAll().filter((r) => r.source !== "local-detected");
  const rowIds = new Set(rows.map((r) => r.id));

  let removed = 0;
  let changed = 0;
  for (const row of rows) {
    if (discoveredIds.has(row.id)) continue;
    removed++;
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
    const packageChanged = loadedPackageChanged(plugin);
    if (packageChanged) changed++;
    store.setStatus({
      ...kept,
      ...discoveryFields(plugin),
      ...(packageChanged ? { restartRequired: true } : {}),
    });
  }
  return { newIds, changed, removed };
}

export function createPluginRefresher(deps: PluginRefresherDeps): PluginRefresher {
  let running: Promise<void> | null = null;
  let followUp: Promise<void> | null = null;

  async function run(): Promise<void> {
    const startedAt = Date.now();
    const store = getPluginStatusStore();
    if (deps.readDeclaredBundledIds) setDeclaredBundledPluginIds(deps.readDeclaredBundledIds());
    clearDiscoveryCache();
    deps.clearContentHashCache?.();
    const { newIds, changed, removed } = reconcileStore(discoverForDeps(deps.loadDeps));

    if (newIds.size > 0) {
      try {
        await loadServerEntries({ ...deps.loadDeps, onlyIds: newIds });
      } catch (e) {
        console.error("[plugin-loader] refresh: additive load failed:", e);
      }
      flagHotRouteFailures(newIds);
    }

    deps.localDetector?.rerun();
    const all = store.listAll();
    console.info(
      `[plugin-loader] refresh: added=${newIds.size} changed=${changed} removed=${removed} ` +
        `local-detected=${all.filter((r) => r.source === "local-detected").length} duration=${Date.now() - startedAt}ms`,
    );
    deps.broadcast(all);
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

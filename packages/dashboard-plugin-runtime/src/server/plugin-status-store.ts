/**
 * In-memory plugin status store.
 * Tracks load success/failure for each discovered plugin and the latest
 * bridge probe snapshot for status-emitting plugins.
 * Consumed by /api/health.plugins[].
 *
 * See change: fix-pi-flows-end-to-end (Group 2).
 */
import type {
  BridgeProbeSnapshot,
  PluginClientStatus,
  PluginStatus,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/plugin-status.js";

/**
 * Derives `PluginStatus.client` at READ time (the runtime-client registry: admission depends on the live
 * content hash, trust and config). Returns `undefined` to keep the stored value.
 */
export type ClientStatusResolver = (status: PluginStatus) => PluginClientStatus | undefined;

export interface PluginStatusStore {
  setStatus(status: PluginStatus): void;
  /** The status row with `client` resolved (when a resolver is installed). */
  getStatus(id: string): PluginStatus | undefined;
  /** The stored row exactly as written (no resolved `client`): the resolver's own input. */
  getStoredStatus(id: string): PluginStatus | undefined;
  /** Stored rows exactly as written (no resolved `client`, no probe / serveApp splice): for read-modify-write callers. */
  listStored(): PluginStatus[];
  /** Install (or clear) the read-time `client` resolver. See change: decouple-plugins-from-core (task 6.7). */
  setClientResolver(resolver: ClientStatusResolver | null): void;
  /**
   * Record the `ctx.serveApp` outcome of a plugin. Kept beside the rows (like probes) so a later
   * `setStatus` from the loader never drops it. See change: decouple-plugins-from-core (task 6.6).
   */
  recordServeApp(pluginId: string, state: "mounted" | "refused"): void;
  /** Drop a row (a removed plugin whose server entry never loaded). No-op when absent. */
  removeStatus(id: string): void;
  listAll(): PluginStatus[];
  /**
   * Record the latest bridge probe for a plugin. The most recent snapshot
   * (highest `at`) wins; older snapshots are discarded. Called from plugin
   * server entries when they receive `<plugin>:status`-style
   * events from pi-side bridges.
   */
  recordBridgeProbe(pluginId: string, snapshot: BridgeProbeSnapshot): void;
  /** Inspect the latest probe for diagnostics. */
  getBridgeProbe(pluginId: string): BridgeProbeSnapshot | undefined;
}

export function createPluginStatusStore(): PluginStatusStore {
  const store = new Map<string, PluginStatus>();
  const probes = new Map<string, BridgeProbeSnapshot>();
  const serveApp = new Map<string, "mounted" | "refused">();
  let resolver: ClientStatusResolver | null = null;
  /** Splice read-time state (resolved client, serveApp outcome) into a stored row. */
  const view = (s: PluginStatus): PluginStatus => {
    const app = serveApp.get(s.id);
    const client = resolver?.(s);
    if (!app && !client) return s;
    return { ...s, ...(client ? { client } : {}), ...(app ? { serveApp: app } : {}) };
  };
  return {
    setStatus(status: PluginStatus) {
      store.set(status.id, status);
    },
    getStatus(id: string) {
      const s = store.get(id);
      return s ? view(s) : undefined;
    },
    getStoredStatus(id: string) {
      return store.get(id);
    },
    listStored(): PluginStatus[] {
      return Array.from(store.values());
    },
    setClientResolver(next: ClientStatusResolver | null) {
      resolver = next;
    },
    recordServeApp(pluginId: string, state: "mounted" | "refused") {
      // A refusal is sticky for the process: a later mount of the same id cannot un-refuse it.
      if (serveApp.get(pluginId) === "refused") return;
      serveApp.set(pluginId, state);
    },
    removeStatus(id: string) {
      store.delete(id);
    },
    listAll(): PluginStatus[] {
      // Splice the latest probe in at read time so callers always see the
      // current snapshot without separate coordination.
      return Array.from(store.values()).map((stored) => {
        const s = view(stored);
        const probe = probes.get(s.id);
        if (!probe) return s;
        return { ...s, lastProbe: probe };
      });
    },
    recordBridgeProbe(pluginId: string, snapshot: BridgeProbeSnapshot) {
      const prev = probes.get(pluginId);
      if (prev && prev.at > snapshot.at) return; // older snapshot, ignore
      probes.set(pluginId, snapshot);
    },
    getBridgeProbe(pluginId: string) {
      return probes.get(pluginId);
    },
  };
}

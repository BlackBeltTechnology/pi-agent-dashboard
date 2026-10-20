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
  PluginStatus,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/plugin-status.js";

export interface PluginStatusStore {
  setStatus(status: PluginStatus): void;
  getStatus(id: string): PluginStatus | undefined;
  /** Drop a row (a removed plugin whose server entry never loaded). No-op when absent. */
  removeStatus(id: string): void;
  listAll(): PluginStatus[];
  /**
   * Record the latest bridge probe for a plugin. The most recent snapshot
   * (highest `at`) wins; older snapshots are discarded. Called from plugin
   * server entries when they receive `flows-anthropic-bridge:status`-style
   * events from pi-side bridges.
   */
  recordBridgeProbe(pluginId: string, snapshot: BridgeProbeSnapshot): void;
  /** Inspect the latest probe for diagnostics. */
  getBridgeProbe(pluginId: string): BridgeProbeSnapshot | undefined;
}

export function createPluginStatusStore(): PluginStatusStore {
  const store = new Map<string, PluginStatus>();
  const probes = new Map<string, BridgeProbeSnapshot>();
  return {
    setStatus(status: PluginStatus) {
      store.set(status.id, status);
    },
    getStatus(id: string) {
      return store.get(id);
    },
    removeStatus(id: string) {
      store.delete(id);
    },
    listAll(): PluginStatus[] {
      // Splice the latest probe in at read time so callers always see the
      // current snapshot without separate coordination.
      return Array.from(store.values()).map((s) => {
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

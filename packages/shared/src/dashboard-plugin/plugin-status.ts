/**
 * Plugin status types used in /api/health.plugins[] and WebSocket broadcasts.
 */

/**
 * Where pi-coding-agent's loader will (or won't) find this plugin's bridge.
 *
 * - `"packages[]"`     — bridge path present in `settings.json#packages[]`
 *                         (pi reads this; bridge will load on session start)
 * - `"dashboardPluginBridges"` — only present in the legacy key pi ignores
 *                         (loaded: false expected)
 * - `"none"`           — plugin has no bridge entry or registration failed
 *
 * See change: fix-pi-flows-end-to-end (Group 2).
 */
export type BridgeLoadSource = "packages[]" | "dashboardPluginBridges" | "none";

/**
 * Structured probe report for a plugin's declarative `requires`.
 * See change: add-plugin-activation-ui (Layer 1.5).
 */
export interface PluginRequirementReport {
  piExtensions: { name: string; satisfied: boolean }[];
  binaries: { name: string; satisfied: boolean; resolvedPath?: string }[];
  services: { name: string; satisfied: boolean; error?: string }[];
  /**
   * Absolute-path existence probes (see `PluginRequirements.paths`). `name`
   * holds the resolved value when a `${configKey}` placeholder resolved, else
   * the declared path verbatim. Always present; `[]` when no `paths` declared.
   * See change: add-apple-tools-imcp-plugin.
   */
  paths: { name: string; satisfied: boolean }[];
}

/**
 * Latest bridge-status probe forwarded from the pi-side extension (for
 * status-emitting bridges like flows-anthropic-bridge). Omitted when the
 * plugin has no bridge or hasn't reported yet.
 */
export interface BridgeProbeSnapshot {
  status: "probing" | "waiting_peers" | "active" | "degraded";
  /** Per-peer probe results keyed by the peer spec (e.g. "@pi/anthropic-messages"). */
  peers: Record<string, { ok: boolean; reason?: string }>;
  /** Unix-ms timestamp when the bridge emitted this snapshot. */
  at: number;
}

/** Status of a single discovered plugin, reported by /api/health. */
export interface PluginStatus {
  id: string;
  /**
   * Human-readable name from the manifest. Used by the Plugins activation
   * UI. Falls back to `id` at the consumer if absent on legacy payloads.
   * See change: add-plugin-activation-ui.
   */
  displayName: string;
  enabled: boolean;
  loaded: boolean;
  /** Error message if the plugin failed to load or has a conflict. */
  error?: string;
  /** Number of slot claims declared in the plugin's manifest. */
  claims: number;
  /**
   * Where the bridge entry is registered, classified at health-check time.
   * See change: fix-pi-flows-end-to-end Group 2.
   */
  bridgeLoadedFrom?: BridgeLoadSource;
  /** Latest bridge-status probe (only present for status-emitting bridges). */
  lastProbe?: BridgeProbeSnapshot;
  /**
   * Structured probe report against the plugin's declarative `requires`.
   * Populated by the loader after `loadServerEntries` and refreshed on every
   * successful `package_operation_complete` and at most every 30 seconds.
   * Absent when the plugin declares no `requires`.
   * See change: add-plugin-activation-ui.
   */
  requirements?: PluginRequirementReport;
  /**
   * Flat list of unsatisfied requirement names across all three categories.
   * Always `[]` when every requirement is satisfied or the plugin declares
   * no `requires`. Never `undefined`.
   * See change: add-plugin-activation-ui.
   */
  missingRequirements?: string[];
  /**
   * `dependsOn` array verbatim from the manifest. Empty when the plugin
   * has no inter-plugin dependencies.
   * See change: add-plugin-activation-ui (Layer 2 — dependency graph).
   */
  dependsOn?: string[];
  /**
   * Plugin ids that declare THIS plugin in their `dependsOn`. Computed
   * by the loader by inverting the graph. Empty when nothing depends on
   * this plugin.
   */
  dependents?: string[];
  /**
   * Plugin ids from `dependsOn` that are either missing from discovery or
   * disabled in config. Non-empty implies the loader skipped this plugin's
   * server entry (`loaded: false`).
   */
  missingDeps?: string[];
}

/** WebSocket broadcast sent to all browsers when a plugin's config changes. */
export interface PluginConfigUpdate {
  type: "plugin_config_update";
  /** Plugin id that was updated. */
  id: string;
  /**
   * Only this plugin's namespace config (plugins.<id>.*).
   * Never contains other plugins' config.
   */
  config: unknown;
}

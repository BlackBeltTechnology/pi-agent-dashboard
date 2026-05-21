import type { SlotId, SettingsTab } from "./slot-types.js";

/**
 * A single slot claim in a plugin manifest.
 */
export interface PluginClaim {
  /** The slot this claim targets. */
  slot: SlotId;
  /** Exported component name from the plugin's client entry (for React slots). */
  component?: string;
  /** Route command for "command-route" slot (e.g. "/specs"). */
  command?: string;
  /** Trigger id for "anchored-popover" slot. */
  trigger?: string;
  /** toolName for "tool-renderer" slot. */
  toolName?: string;
  /**
   * For "settings-section" slot: which SettingsPanel tab to render in.
   * Defaults to "general" if omitted.
   */
  tab?: SettingsTab;
  /**
   * URL path pattern (wouter syntax, must start with "/") for the
   * `shell-overlay-route` slot. First-class field so the slot consumer
   * has a typed contract instead of digging through `config`.
   * Example: "/session/:sid/flow/:flowId/agent/:agentId".
   *
   * See change: fix-flows-plugin-polish (path-as-first-class-claim-field).
   */
  path?: string;
  /**
   * For `shell-overlay-route` claims: which URL parameter holds the session
   * id. The slot consumer uses this to resolve the parent session metadata
   * via `useShellSession`. Defaults to "sid" when omitted.
   *
   * See change: fix-flows-plugin-polish (path-as-first-class-claim-field).
   */
  sessionParam?: string;
  /** Slot-specific extra config (escape hatch — prefer first-class fields). */
  config?: Record<string, unknown>;
  /**
   * Optional exported predicate function name for filtering contributions.
   * Answers "does this claim apply to this target?" — a claim failing its
   * predicate is removed from the slot's claim list entirely.
   */
  predicate?: string;
  /**
   * Optional exported sync function name. Answers "will this claim's component
   * produce visible output for this target?" — a claim whose shouldRender
   * returns false is NOT mounted and counts as absent for the wrapper-gate
   * helpers (e.g. `useSlotHasClaimsForSession`), so parent subcards hide
   * cleanly. Use when the component conditionally returns `null` based on
   * dynamic state (e.g. "extension not installed"). MUST be synchronous.
   *
   * See change: auto-hide-empty-session-subcards.
   */
  shouldRender?: string;
}

/**
 * Declarative requirements a plugin has on its environment.
 * Probed by the dashboard-plugin-runtime; surfaced in PluginStatus.requirements.
 *
 * Names are matched against pi extensions (via /api/packages/installed),
 * binaries (via the shared ToolRegistry), and named service probes from a
 * closed built-in registry. Plugins SHALL NOT register additional service
 * names in V1.
 *
 * See change: add-plugin-activation-ui (Layer 1.5).
 */
export interface PluginRequirements {
  /** pi extension package identifiers (matched via the same logic
      RECOMMENDED_EXTENSIONS uses: name / id / source / displayName). */
  piExtensions?: string[];
  /** Binaries that must resolve on PATH via the tool-registry. */
  binaries?: string[];
  /** Named service probes (closed built-in registry; "pi-model-proxy" only in V1). */
  services?: string[];
}

/**
 * The pi-dashboard-plugin manifest.
 * Declared as the `pi-dashboard-plugin` field in a package.json,
 * or as a top-level `dashboard-plugin.json` adjacent to package.json.
 */
export interface PluginManifest {
  /** Globally unique kebab-case plugin id. */
  id: string;
  /** Human-readable display name. */
  displayName: string;
  /**
   * Lower number = rendered earlier in multi-contribution slots.
   * Default 1000. First-party plugins use 100.
   */
  priority?: number;
  /** Relative path to the bundled client entry (from package root). */
  client?: string;
  /** Optional relative path to the server entry. */
  server?: string;
  /** Optional relative path to a pi-extension/bridge entry. */
  bridge?: string;
  /** Optional relative path to a JSON Schema 7 file for plugin config validation. */
  configSchema?: string;
  /** Slot claims. */
  claims: PluginClaim[];
  /**
   * Optional declarative requirements probed by the runtime and surfaced as
   * `PluginStatus.requirements` / `missingRequirements`.
   * See change: add-plugin-activation-ui (Layer 1.5).
   */
  requires?: PluginRequirements;
  /**
   * Other plugin ids this plugin requires (hard, transitive). When a
   * dependency is missing from discovery or disabled in config, the loader
   * SHALL skip this plugin's server entry and surface the gap via
   * `PluginStatus.missingDeps`. Cycles soft-fail at discovery (loaded: false
   * for every plugin in the cycle).
   *
   * See change: add-plugin-activation-ui (Layer 2 — dependency graph).
   */
  dependsOn?: string[];
  /**
   * When true, the plugin is a test fixture and SHALL be excluded from
   * production bundles (NODE_ENV=production).
   */
  fixture?: boolean;
}

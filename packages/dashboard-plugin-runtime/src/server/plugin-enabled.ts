/**
 * Plugin enablement resolution (spec add-browser-relay, design Migration Plan
 * step 2 — "plugin disabled by default").
 *
 * Historically every enabled check was `cfg?.enabled !== false` — default
 * allow. A plugin with real-user surface (the browser relay drives the
 * operator's SSO Chrome) must ship opt-in, so manifests may declare
 * `defaultEnabled: false` and this helper resolves the three-way rule in ONE
 * place:
 *
 *   explicit `enabled` in config  →  that value
 *   else manifest.defaultEnabled  →  that value
 *   else                          →  true (historical default-allow)
 *
 * See change: add-browser-relay (GAP B).
 */

/**
 * Resolve whether a plugin is enabled.
 *
 * @param configValue the plugin's raw config block (`plugins.<id>` — may be
 *   undefined for a fresh install).
 * @param defaultEnabled the manifest's `defaultEnabled` (undefined = true).
 */
export function resolvePluginEnabled(configValue: unknown, defaultEnabled?: boolean): boolean {
  if (typeof configValue === "object" && configValue !== null) {
    const enabled = (configValue as { enabled?: unknown }).enabled;
    if (typeof enabled === "boolean") return enabled;
  }
  return defaultEnabled ?? true;
}

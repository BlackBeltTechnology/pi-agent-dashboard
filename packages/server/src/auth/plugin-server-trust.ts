/**
 * Operator server-trust for `pi-package` plugins (design D12, R9). A `pi-package` winner's
 * server entry and bridge load only when `auth.trustedPlugins` carries an entry for its id with
 * `server: true`; default-deny. The config field and its grant endpoint land with tasks 6.5 /
 * 6.12, so until then the read below finds nothing and every `pi-package` server entry stays
 * refused (`server-untrusted`).
 *
 * See change: decouple-plugins-from-core (task 5.2).
 */
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";

export interface PluginServerTrustEntry {
  id: string;
  server?: boolean;
}

/** Pure decision: an entry for `pluginId` with `server === true`. */
export function isPluginServerTrusted(pluginId: string, entries: readonly PluginServerTrustEntry[] | undefined): boolean {
  return (entries ?? []).some((e) => e.id === pluginId && e.server === true);
}

/** `auth.trustedPlugins` as the config holds it (loose read: the typed field arrives with task 6.5). */
export function readServerTrustEntries(): readonly PluginServerTrustEntry[] {
  const auth = loadConfig().auth as { trustedPlugins?: unknown } | undefined;
  const list = auth?.trustedPlugins;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (e): e is PluginServerTrustEntry => typeof e === "object" && e !== null && typeof (e as { id?: unknown }).id === "string",
  );
}

/** Live predicate handed to the loader (`ServerLoadDeps.isServerTrusted`). */
export function isServerTrusted(plugin: { manifest: { id: string } }): boolean {
  return isPluginServerTrusted(plugin.manifest.id, readServerTrustEntries());
}

/**
 * Operator server-trust for `pi-package` plugins (design D12, R9). A `pi-package` winner's
 * server entry and bridge load only when `auth.trustedPlugins` carries an entry for its id with
 * `server: true`; default-deny. The grant endpoint is `POST /api/plugins/:id/trust {server:true}`
 * (task 6.12); the list is read live from config and written only by `plugin-trust-store.ts`.
 *
 * See change: decouple-plugins-from-core (tasks 5.2, 6.5).
 */
import { readTrustedPlugins } from "./plugin-trust-store.js";

export interface PluginServerTrustEntry {
  id: string;
  server?: boolean;
}

/** Pure decision: an entry for `pluginId` with `server === true`. */
export function isPluginServerTrusted(pluginId: string, entries: readonly PluginServerTrustEntry[] | undefined): boolean {
  return (entries ?? []).some((e) => e.id === pluginId && e.server === true);
}

/** `auth.trustedPlugins` (typed, normalized) as the config holds it. */
export function readServerTrustEntries(): readonly PluginServerTrustEntry[] {
  return readTrustedPlugins();
}

/** Live predicate handed to the loader (`ServerLoadDeps.isServerTrusted`). */
export function isServerTrusted(plugin: { manifest: { id: string } }): boolean {
  return isPluginServerTrusted(plugin.manifest.id, readServerTrustEntries());
}

/**
 * In-memory cache of the most-recently-pushed provider catalogue.
 *
 * Each pi process pushes a `providers_list` over WS, derived from its
 * `ModelRegistry`. The server caches the latest snapshot. `GET
 * /api/provider-auth/status` reads `getLatestCatalogue()`.
 *
 * The catalogue is a property of the machine's auth + provider config,
 * not of individual sessions: every bridge in the same process tree
 * derives an identical catalogue from `~/.pi/agent/auth.json` +
 * `~/.pi/agent/providers.json` + pi-ai's MODELS table. We therefore
 * keep ONE global snapshot — the last push wins. A previous version
 * kept a per-session Map plus a `changed` deep-equality gate to avoid
 * spurious `models_refreshed` broadcasts; that broadcast is gone
 * (see change: simplify-model-selection-channels), so the gate is
 * unnecessary and the per-session split was redundant.
 *
 * See changes: replace-hardcoded-provider-lists,
 *              fix-providers-list-spurious-models-refreshed,
 *              simplify-model-selection-channels.
 */
import type { ProviderInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

let latest: ProviderInfo[] | null = null;

/**
 * Replace the cached catalogue. Called from event-wiring.ts on every
 * `providers_list` arrival. No-op semantically beyond the assignment;
 * no signal to callers because no caller needs one.
 */
export function setCatalogueForSession(_sessionId: string, providers: ProviderInfo[]): void {
  latest = providers;
}

/**
 * Most recent catalogue across any session. Returns [] when no bridge
 * has pushed yet — callers should treat that as "waiting for pi" and
 * may issue a `request_providers` nudge to fetch one synchronously.
 */
export function getLatestCatalogue(): ProviderInfo[] {
  return latest ?? [];
}

/** Test-only: reset all cached state. */
export function _resetForTests(): void {
  latest = null;
}

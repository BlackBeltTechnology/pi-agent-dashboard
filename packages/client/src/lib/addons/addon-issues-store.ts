/**
 * One shared source for the Add-ons issue count: plugin issues (enabled plugins
 * that failed to load or miss a requirement) plus `packages[]` health entries.
 * The Issues tab and the Settings rail badge read the same snapshot, so they can
 * never disagree and one fetch pair serves both.
 *
 * A failed health request leaves `health: null` — plugin issues only, no error.
 * Refreshed on Settings mount, after a cleanup Apply and after a plugin toggle
 * (`plugin-config-update`).
 *
 * See change: addons-hub-folder-view (design D5, D9).
 */
import type { PackageHealthListResponseData } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { countHealthIssues, fetchPackageHealth } from "../package/package-health-api.js";
import { listPlugins, type PluginRow } from "../package/plugins-api.js";

export interface AddonIssuesSnapshot {
	/** Enabled plugins with a load error or a missing requirement. */
	pluginIssues: PluginRow[];
	/** `null` until fetched or when the request failed. */
	health: PackageHealthListResponseData | null;
	/** Plugin issues + every non-`ok` health entry. */
	count: number;
	loaded: boolean;
}

const EMPTY: AddonIssuesSnapshot = { pluginIssues: [], health: null, count: 0, loaded: false };

let snapshot: AddonIssuesSnapshot = EMPTY;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function isPluginIssue(row: PluginRow): boolean {
	const s = row.status;
	if (!s?.enabled) return false;
	return !!s.error || (s.missingRequirements?.length ?? 0) > 0;
}

function publish(next: AddonIssuesSnapshot): void {
	snapshot = next;
	for (const l of listeners) l();
}

export function subscribeAddonIssues(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getAddonIssues(): AddonIssuesSnapshot {
	return snapshot;
}

/** Re-fetch plugins + health. Concurrent calls share one request pair. */
export function refreshAddonIssues(): Promise<void> {
	if (inFlight !== null) return inFlight;
	inFlight = (async () => {
		const [plugins, health] = await Promise.all([
			listPlugins().catch(() => null),
			fetchPackageHealth().catch(() => null),
		]);
		const pluginIssues = Array.isArray(plugins) ? plugins.filter(isPluginIssue) : snapshot.pluginIssues;
		const healthKept = health ?? null;
		publish({
			pluginIssues,
			health: healthKept,
			count: pluginIssues.length + (healthKept ? countHealthIssues(healthKept) : 0),
			loaded: true,
		});
	})().finally(() => {
		inFlight = null;
	});
	return inFlight;
}

/** Test seam. */
export function __resetAddonIssuesStore(): void {
	snapshot = EMPTY;
	inFlight = null;
	listeners.clear();
}

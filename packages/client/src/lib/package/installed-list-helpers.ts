/**
 * Pure client-side helpers for the installed-packages UI.
 *
 * `computeDestIdentity` mirrors the server's `computeIdentity` for non-
 * filesystem cases (npm, git, https). For path sources we don't have
 * the settings.json directory at hand, so we fall back to the literal
 * source string. This is safe for the "already-at-destination" preflight
 * because path sources are unique per-folder anyway.
 *
 * See change: unify-package-management-ui.
 */

import { classifySource } from "./package-classifier.js";

const PROTOCOL_PREFIXES = ["https://", "http://", "ssh://", "git://"];

/**
 * Compute a string identity for dedup'ing installed-package rows across
 * scopes. Mirrors the server's `computeIdentity` for the cases this
 * code paths through (npm, git, https). Path sources fall back to the
 * literal source string since we don't have absolute-path resolution
 * in the browser.
 */
export function computeDestIdentity(source: string): string {
	if (source.startsWith("npm:")) {
		const rest = source.slice(4);
		const scoped = rest.startsWith("@");
		const atIdx = scoped ? rest.indexOf("@", 1) : rest.indexOf("@");
		const name = atIdx >= 0 ? rest.slice(0, atIdx) : rest;
		return `npm:${name}`;
	}
	if (source.startsWith("git:") || PROTOCOL_PREFIXES.some((p) => source.startsWith(p))) {
		const lastAt = source.lastIndexOf("@");
		if (lastAt > 0) {
			const tail = source.slice(lastAt + 1);
			if (!tail.includes(":") && !tail.includes("/")) {
				return source.slice(0, lastAt);
			}
		}
		return source;
	}
	// Path sources — fall back to literal. Safe because path identity is
	// already unique per directory; cross-scope duplication detection
	// happens server-side in the Move endpoint anyway.
	return source;
}

// ── Add-ons page helpers ───────────────────────────────────────────────
// See change: addons-hub-declutter (design D6).

/** Window event: "move this query to the npm search" (installed filter → Browse panel). */
export const ADDONS_NPM_SEARCH_EVENT = "pi-addons-npm-search";

/** Rows the Add-ons UI renders: dashboard-managed plugin bridges are never listed. */
export function visibleInstalledRows<T extends object>(rows: readonly T[]): T[] {
	return rows.filter((r) => (r as { dashboardManaged?: boolean }).dashboardManaged !== true);
}

/** True when the row runs from a local path or git checkout. One predicate for
 * the `Local source` chip, the banner count and the per-row badge. */
export function isLocalSourceRow(row: { source: string }): boolean {
	const kind = classifySource(row.source);
	return kind === "local" || kind === "git";
}

export interface InstalledFilter {
	text: string;
	localOnly: boolean;
	updateOnly: boolean;
}

export const EMPTY_INSTALLED_FILTER: InstalledFilter = { text: "", localOnly: false, updateOnly: false };

export function isInstalledFilterActive(f: InstalledFilter): boolean {
	return f.text.trim() !== "" || f.localOnly || f.updateOnly;
}

/** AND-combine the text filter (name, source, description; case-insensitive
 * substring) with the chips. `hasUpdate` supplies the update state per row. */
export function filterInstalledRows<
	T extends { source: string; displayName?: string; description?: string },
>(rows: readonly T[], filter: InstalledFilter, hasUpdate: (row: T) => boolean): T[] {
	const needle = filter.text.trim().toLowerCase();
	return rows.filter((row) => {
		if (filter.localOnly && !isLocalSourceRow(row)) return false;
		if (filter.updateOnly && !hasUpdate(row)) return false;
		if (!needle) return true;
		return [row.displayName, row.source, row.description].some((s) => !!s && s.toLowerCase().includes(needle));
	});
}

/**
 * Pure helpers for the unified packages settings UI.
 *
 *  - `classifySource`: derives a source-type badge from a raw source string.
 *  - `isSourceOverride`: true when a recommended (npm-identity) package is
 *    actually installed from a local/git checkout.
 *  - `groupInstalledPackages`: splits enriched installed rows into
 *    Recommended / Other, dropping any row that matches the Core whitelist
 *    so a Core row never duplicates into Other.
 *
 * See change: consolidate-packages-settings-ui.
 * See change: flag-package-source-overrides.
 */
import type { InstalledPackage } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

export type SourceType = "npm" | "git" | "local" | "global";

/** Derive the badge category from a raw `source` string. Pure. */
export function classifySource(source: string): SourceType {
	if (source.startsWith("npm:")) return "npm";
	if (source.startsWith("file://")) return "local";
	if (source.startsWith("/") || source.startsWith("./") || source.startsWith("../")) return "local";
	if (/^[a-zA-Z]:[\\/]/.test(source)) return "local"; // Windows drive path
	if (
		source.startsWith("git@") ||
		source.startsWith("ssh://") ||
		source.startsWith("git:") ||
		/^https?:\/\//i.test(source) ||
		source.endsWith(".git")
	) {
		return "git";
	}
	return "global";
}

/**
 * True when a row has a canonical npm identity (`isRecommended`, i.e. its
 * `source` matched a `RECOMMENDED_EXTENSIONS` npm entry via `sourcesMatch`)
 * BUT its actual installed `source` is not an npm spec — "declared as npm,
 * installed from a local/git checkout". Pure; drives the `override` remark
 * only (never the Update affordance). `isRecommended` is optional on the wire
 * type, so `=== true` makes an un-enriched row resolve to non-override.
 * See change: flag-package-source-overrides.
 */
export function isSourceOverride(pkg: InstalledPackage): boolean {
	return pkg.isRecommended === true && classifySource(pkg.source) !== "npm";
}

/** Extract the npm package name from an `npm:<name>[@<version>]` source.
 * Returns null if the source isn't an npm spec. Pure. */
export function npmNameFromSource(source: string): string | null {
	if (!source.startsWith("npm:")) return null;
	const rest = source.slice("npm:".length);
	// Scoped: @scope/name[@version] — split on second @
	if (rest.startsWith("@")) {
		const at = rest.indexOf("@", 1);
		return at === -1 ? rest : rest.slice(0, at);
	}
	// Bare: name[@version]
	const at = rest.indexOf("@");
	return at === -1 ? rest : rest.slice(0, at);
}

/** Split enriched installed-package rows into Recommended + Other,
 * dropping rows whose npm name matches a Core whitelist entry. Pure. */
export function groupInstalledPackages(
	installed: InstalledPackage[],
	coreNpmNames: readonly string[],
): { recommended: InstalledPackage[]; other: InstalledPackage[] } {
	const recommended: InstalledPackage[] = [];
	const other: InstalledPackage[] = [];
	const coreSet = new Set(coreNpmNames);

	for (const row of installed) {
		const npmName = npmNameFromSource(row.source);
		if (npmName && coreSet.has(npmName)) continue; // Core wins
		if (row.isRecommended) recommended.push(row);
		else other.push(row);
	}

	return { recommended, other };
}

/**
 * Minimal semver-ish comparison helpers for pi versions.
 *
 * Moved verbatim from `packages/server/src/pi/pi-version-skew.ts` so the
 * shared pi-install enumerator + override validator can use them without
 * depending on the server. `pi-version-skew.ts` re-exports them, so its
 * public surface is unchanged.
 *
 * See change: select-pi-runtime-install (design D11).
 */

/**
 * Parse a semver-ish string into its three numeric segments. Returns
 * null when the string doesn't match `<n>.<n>.<n>` (with optional
 * pre-release / build suffix which we ignore for comparison). This is
 * deliberately minimal — pi versions have always been `0.x.y` and we
 * don't want to pull in the `semver` dep.
 */
export function parseVersion(v: string): [number, number, number] | null {
	const m = v
		.trim()
		.replace(/^v/, "")
		.match(/^(\d+)\.(\d+)\.(\d+)/);
	if (!m) return null;
	return [
		Number.parseInt(m[1], 10),
		Number.parseInt(m[2], 10),
		Number.parseInt(m[3], 10),
	];
}

/**
 * Compare two version strings. Returns -1 if `a < b`, 0 if equal, 1 if
 * `a > b`. Unparseable strings sort as equal (conservative — don't flag
 * weird versions as outdated).
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
	const A = parseVersion(a);
	const B = parseVersion(b);
	if (!A || !B) return 0;
	for (let i = 0; i < 3; i++) {
		if (A[i] < B[i]) return -1;
		if (A[i] > B[i]) return 1;
	}
	return 0;
}

/**
 * Return true if `version` is less than `threshold`. Delegates to
 * `compareVersions` so unparseable strings never flag as "too old".
 */
export function isBelow(version: string, threshold: string): boolean {
	return compareVersions(version, threshold) < 0;
}

/**
 * Return true if `version` is strictly above `threshold`. `threshold`
 * may include a `.x` wildcard in the patch slot (e.g. `"0.9.x"`); in
 * that case the wildcard matches any patch, so `"0.9.5"` is NOT above
 * `"0.9.x"` but `"0.10.0"` is.
 */
export function isAbove(version: string, threshold: string): boolean {
	const thresholdClean = threshold.replace(/\.x$/i, ".99999");
	return compareVersions(version, thresholdClean) > 0;
}

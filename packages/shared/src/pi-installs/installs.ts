/**
 * Pi install enumeration + version reading, promoted verbatim from the doctor
 * skill's `_lib/checks.ts` so the doctor and the server share ONE
 * implementation (design D1). Filesystem-only: never spawns `pi --version`.
 *
 * Also owns the single pi compatibility-floor reader (design D11): the picker
 * and `/api/health` both route through `resolvePiFloor`, so the old
 * `null`-vs-`0.6.7` split for a missing `package.json` cannot recur.
 *
 * See change: select-pi-runtime-install.
 */

import { existsSync, readFileSync } from "node:fs";

export interface PiInstall {
	/** Human label for the consumer/location. */
	location: string;
	/** Absolute path the install resolves from, or null when not found. */
	resolvedPath: string | null;
	/** Parsed package.json version, or null. */
	version: string | null;
}

/** Read a `version` field from a package.json path; null on any failure. */
export function readPkgVersion(pkgJsonPath: string): string | null {
	try {
		const raw = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
			version?: string;
		};
		return typeof raw.version === "string" ? raw.version : null;
	} catch {
		return null;
	}
}

/**
 * Enumerate pi installs across candidate locations and read each version from
 * its package.json. `locations` maps a human label to a candidate package
 * directory (repo node_modules, managed dir, nvm-global, …). The caller
 * supplies the candidate dirs; this helper only resolves + reads versions so
 * it stays platform-agnostic and testable with fixtures.
 */
export function enumeratePiInstalls(
	locations: Record<string, string>,
): PiInstall[] {
	const out: PiInstall[] = [];
	for (const [location, dir] of Object.entries(locations)) {
		const pkgJson = `${dir}/package.json`;
		if (existsSync(pkgJson)) {
			out.push({
				location,
				resolvedPath: dir,
				version: readPkgVersion(pkgJson),
			});
		} else {
			out.push({ location, resolvedPath: null, version: null });
		}
	}
	return out;
}

/**
 * Given the enumerated installs, return the set of distinct non-null versions.
 * More than one distinct version means the INSTALL SET diverges.
 *
 * NOTE: this is *install-set* divergence, a different question from *consumer*
 * divergence (which of the two pi consumers resolve to different installs).
 * The two are reported under distinct labels and never conflated — see
 * design D5.
 */
export function piVersionDivergence(installs: PiInstall[]): {
	diverged: boolean;
	versions: string[];
} {
	const versions = [
		...new Set(installs.map((i) => i.version).filter((v): v is string => !!v)),
	];
	return { diverged: versions.length > 1, versions };
}

/** Compatibility range declared in `packages/server/package.json`. */
export interface PiCompatibilityRange {
	minimum: string;
	recommended: string;
	maximum: string | null;
}

/**
 * Fallback used when the server package.json is absent or malformed (e.g. a
 * packaged deployment that does not ship it). `0.6.7` predates every
 * supported pi, so the floor check degrades to "never gate" rather than to
 * "gate everything".
 */
export const PI_COMPATIBILITY_FALLBACK: PiCompatibilityRange = {
	minimum: "0.6.7",
	recommended: "0.6.7",
	maximum: null,
};

/**
 * Read the declared compatibility range from a server package.json on disk.
 * Returns `null` when the file is missing or the field is absent/malformed —
 * callers decide whether that means "no gating" (`resolvePiFloor`) or
 * "unknown" (`readPiFloor`).
 */
export function readPiCompatibilityRange(
	serverPkgJsonPath: string,
): PiCompatibilityRange | null {
	try {
		const parsed = JSON.parse(readFileSync(serverPkgJsonPath, "utf8")) as {
			piCompatibility?: {
				minimum?: string;
				recommended?: string;
				maximum?: string | null;
			};
		};
		const c = parsed.piCompatibility;
		if (c && typeof c.minimum === "string") {
			return {
				minimum: c.minimum,
				recommended:
					typeof c.recommended === "string" ? c.recommended : c.minimum,
				maximum: c.maximum ?? null,
			};
		}
	} catch {
		/* fall through */
	}
	return null;
}

/**
 * Read the pi compatibility floor from a server package.json on disk
 * (`piCompatibility.minimum`). Shell-first: no server call needed.
 * Returns `null` when it cannot be read — the doctor reports "unknown floor"
 * rather than inventing one.
 */
export function readPiFloor(serverPkgJsonPath: string): string | null {
	return readPiCompatibilityRange(serverPkgJsonPath)?.minimum ?? null;
}

/**
 * THE floor reader for gating decisions. Both the runtime picker and
 * `/api/health` route through this, so a missing package.json can never mean
 * "no floor" on one surface and `0.6.7` on the other (design D11).
 */
export function resolvePiFloor(serverPkgJsonPath: string): string {
	return readPiFloor(serverPkgJsonPath) ?? PI_COMPATIBILITY_FALLBACK.minimum;
}

/**
 * Doctor check library — thin wrappers over the existing `shared/` resolution
 * primitives. The doctor NEVER reimplements resolution; it composes
 * `resolvePiPackage`, `resolvePiPackageEntry`, `listPiPackages`,
 * `sourcesMatch`, and `parseSourceKey`. Shell-first: every helper reads files
 * + `createRequire` and works with the dashboard server down.
 *
 * See change: add-modular-doctor-skill (design.md D4/D8, spec: Derive-on-run).
 */

import { createRequire } from "node:module";
import {
	enumeratePiInstalls,
	type PiInstall,
	piVersionDivergence,
	readPiFloor,
	resolvePiFloor,
} from "@blackbelt-technology/pi-dashboard-shared/pi-installs/index.js";
import {
	listPiPackages,
	type ResolvePiPackageOptions,
	resolvePiPackage,
	resolvePiPackageEntry,
} from "@blackbelt-technology/pi-dashboard-shared/pi-package-resolver.js";
import {
	parseSourceKey,
	type SourceKey,
	sourcesMatch,
} from "@blackbelt-technology/pi-dashboard-shared/source-matching.js";

export type { PiInstall, ResolvePiPackageOptions, SourceKey };
// Pi-install enumeration + floor reading live in `shared/pi-installs/` so the
// doctor and the server cannot drift (change: select-pi-runtime-install, D1).
// Re-export the primitives so modules import them from one place (DRY: the
// wrappers below are the ONLY doctor-specific additions).
export {
	enumeratePiInstalls,
	listPiPackages,
	parseSourceKey,
	piVersionDivergence,
	readPiFloor,
	resolvePiFloor,
	resolvePiPackage,
	resolvePiPackageEntry,
	sourcesMatch,
};

export type PeerTier = "tier-1" | "tier-2" | null;

export interface PeerProbeResult {
	spec: string;
	/** Which tier resolved the peer, or null when unresolved. */
	tier: PeerTier;
	/** Absolute resolved entry path, or null. */
	resolvedPath: string | null;
	present: boolean;
}

/**
 * Probe a peer via tier-1 then tier-2 resolution, mirroring how the bridge
 * actually resolves peers (`peer-probe.ts`):
 *  - tier-1: `createRequire(cwd + "/_").resolve(spec)` (anchored at session cwd)
 *  - tier-2: `resolvePiPackageEntry(spec)` (walks pi `packages[]`)
 * A peer is PRESENT if either tier resolves it.
 */
export function probePeer(
	spec: string,
	opts: ResolvePiPackageOptions = {},
): PeerProbeResult {
	// Tier 1 — cwd-anchored createRequire.
	if (opts.cwd) {
		try {
			const req = createRequire(`${opts.cwd}/_`);
			const resolved = req.resolve(spec);
			return { spec, tier: "tier-1", resolvedPath: resolved, present: true };
		} catch {
			// fall through to tier 2
		}
	}
	// Tier 2 — pi packages[].
	const entry = resolvePiPackageEntry(spec, opts);
	if (entry) {
		return { spec, tier: "tier-2", resolvedPath: entry, present: true };
	}
	return { spec, tier: null, resolvedPath: null, present: false };
}

export interface NameSkewResult {
	/** The name that actually resolved (the current package), or null. */
	resolvedName: string | null;
	/** Names probed but unresolved (stale / rescoped). */
	staleNames: string[];
	tier: PeerTier;
	resolvedPath: string | null;
}

/**
 * Probe a set of candidate names for one logical peer (e.g. the current
 * `@scope/pi-anthropic-messages` and its legacy `@pi/anthropic-messages`
 * alias). Reports which name currently resolves and which probed names are
 * dead — the signal for published-bridge name skew after a rescope.
 */
export function detectNameSkew(
	candidates: string[],
	opts: ResolvePiPackageOptions = {},
): NameSkewResult {
	const stale: string[] = [];
	for (const name of candidates) {
		const res = probePeer(name, opts);
		if (res.present) {
			// Names probed before the hit (still in `stale`) are the dead aliases.
			return {
				resolvedName: name,
				staleNames: stale,
				tier: res.tier,
				resolvedPath: res.resolvedPath,
			};
		}
		stale.push(name);
	}
	return { resolvedName: null, staleNames: stale, tier: null, resolvedPath: null };
}


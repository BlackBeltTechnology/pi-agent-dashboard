/**
 * Server-side composition of the shared pi-install enumerator: binds the
 * live locations (`MANAGED_DIR`, `npm root -g`, PATH, repo root, bare-import
 * anchor) and maps each of the two consumers' current resolutions back onto a
 * candidate.
 *
 * Consumer divergence is defined on the realpath'd PACKAGE DIRECTORY, not on
 * the version — the same axis the picker's "Keep both in sync" checkbox uses.
 * Defining sync on directory and divergence on version would leave two
 * different installs holding the same version reported as "in sync" by one
 * surface and "diverged" by another (design D5/D7a).
 *
 * Install-set divergence (">1 distinct version anywhere on the box") is a
 * DIFFERENT question and is reported under its own label — never conflated.
 *
 * See change: select-pi-runtime-install.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { getManagedDir } from "@blackbelt-technology/pi-dashboard-shared/managed-paths.js";
import {
	enumeratePiCandidates,
	type PiCandidate,
	piVersionDivergence,
	pkgDirForEntry,
	readPkgVersion,
	resolvePiFloor,
	samePackageDir,
} from "@blackbelt-technology/pi-dashboard-shared/pi-installs/index.js";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import * as npm from "@blackbelt-technology/pi-dashboard-shared/platform/npm.js";
import {
	getDefaultRegistry,
	type ToolRegistry,
} from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";

/** The two pi consumers, by registered tool name. */
export const PI_SPAWN_TOOL = "pi";
export const PI_MODULE_TOOL = "pi-coding-agent";

interface PiRuntimeConsumer {
	/** Resolved entry path, or null when unresolvable. */
	path: string | null;
	/** Containing package directory after realpath, or null. */
	pkgDir: string | null;
	version: string | null;
	/** Key of the matching candidate, or null when it matches none. */
	candidateKey: string | null;
	/** True when an explicit override pins this consumer. */
	pinned: boolean;
}

export interface PiRuntimeSnapshot {
	candidates: PiCandidate[];
	spawn: PiRuntimeConsumer;
	module: PiRuntimeConsumer;
	/** The two consumers resolve to the same install (realpath'd pkg dir). */
	inSync: boolean;
	/** CONSUMER divergence — the predicate the picker and /api/health report. */
	consumerDiverged: boolean;
	/** INSTALL-SET divergence — >1 distinct version across enumerated installs. */
	installSetDiverged: boolean;
	installSetVersions: string[];
	floor: string;
}

/** Path to `packages/server/package.json`, the floor's single source. */
function serverPkgJsonPath(): string {
	return path.join(
		path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))),
		"package.json",
	);
}

let resolver: ToolResolver | null = null;
function which(name: string): string | null {
	resolver ??= new ToolResolver({
		processExecPath: process.execPath,
		useLoginShell: true,
	});
	return resolver.which(name);
}

/**
 * Test-harness seam: point candidate enumeration at a FIXTURE TREE instead of
 * the live locations, so an L3 browser test can drive "two installs at
 * different versions", "a candidate below the floor", or "a candidate whose
 * version cannot be read" — states that cannot be produced on a real host.
 *
 * Layout under `<dir>`: `anchor/`, `managed/`, `npmroot/`, `repo/` (each in the
 * shape the matching strategy probes) and an optional `server-package.json`
 * carrying `piCompatibility.minimum`.
 *
 * Opt-in only: unset (the default, including every real deployment) changes
 * nothing. Deliberately NOT a config field — it must not be settable from the
 * network surface, only from the process environment that started the server.
 *
 * See change: select-pi-runtime-install.
 */
const PI_FIXTURE_ENV = "PI_DASHBOARD_PI_FIXTURE_DIR";

function fixtureDeps(env: NodeJS.ProcessEnv): PiRuntimeDeps | null {
	const dir = env[PI_FIXTURE_ENV];
	if (!dir) return null;
	const npmRoot = path.join(dir, "npmroot");
	return {
		anchorDir: path.join(dir, "anchor"),
		managedDir: path.join(dir, "managed"),
		repoRoot: path.join(dir, "repo"),
		npmRootGlobal: () => npmRoot,
		which: () => null,
		floorPath: path.join(dir, "server-package.json"),
	};
}

export interface PiRuntimeDeps {
	registry?: ToolRegistry;
	/** Overridden in tests to avoid touching the real filesystem. */
	floorPath?: string;
	npmRootGlobal?(): string;
	which?(name: string): string | null;
	managedDir?: string;
	repoRoot?: string;
	anchorDir?: string;
}

/**
 * What one consumer currently resolves to.
 *
 * `pkgDir` and `version` are derived from the consumer's OWN resolved entry,
 * NOT from a matched candidate. Taking them from the match would make them null
 * whenever a consumer is pinned to a real install that enumeration does not
 * offer (a homebrew path, a custom bin dir, an install outside every probed
 * location) — and `consumerDiverged` requires both sides to be known, so the
 * mismatch would be silently suppressed on exactly the configuration D5 says
 * must always be observable. The `current` synthesised row backstops only the
 * SPAWN consumer, so the import side had no backstop at all.
 *
 * `candidateKey` still comes from the match, and stays null for an
 * unrecognised install — that is honest: there is no row to highlight.
 */
function consumerOf(
	registry: ToolRegistry,
	tool: string,
	candidates: PiCandidate[],
): PiRuntimeConsumer {
	const res = registry.resolve(tool);
	const entry = res.ok ? res.path : null;
	if (!entry) {
		return {
			path: null,
			pkgDir: null,
			version: null,
			candidateKey: null,
			pinned: res.source === "override",
		};
	}
	const ownPkgDir = pkgDirForEntry(entry);
	const match =
		candidates.find(
			(c) =>
				samePackageDir(c.spawnEntry, entry) ||
				samePackageDir(c.moduleEntry, entry) ||
				// Realpath both sides: the two arms above already do, and a raw
				// string prefix would miss a symlinked resolution into a candidate.
				samePackageDir(c.pkgDir, ownPkgDir),
		) ?? null;
	return {
		path: entry,
		pkgDir: ownPkgDir ?? match?.pkgDir ?? null,
		version: match?.version ?? (ownPkgDir ? readPkgVersion(path.join(ownPkgDir, "package.json")) : null),
		candidateKey: match?.key ?? null,
		pinned: res.source === "override",
	};
}

/**
 * Snapshot every pi candidate plus what each consumer currently resolves to.
 * Filesystem-only for versions; `npm root -g` / PATH lookups are cached by
 * the shared enumerator and invalidated by `registry.rescan()`.
 */
export function piRuntimeSnapshot(
	deps: PiRuntimeDeps = {},
): PiRuntimeSnapshot {
	// Explicit deps win over the fixture seam, which wins over the live host.
	const merged: PiRuntimeDeps = { ...(fixtureDeps(process.env) ?? {}), ...deps };
	deps = merged;
	const registry = deps.registry ?? getDefaultRegistry();
	const floor = resolvePiFloor(deps.floorPath ?? serverPkgJsonPath());
	const current = registry.resolve(PI_SPAWN_TOOL);

	const candidates = enumeratePiCandidates({
		anchorDir: deps.anchorDir ?? path.dirname(fileURLToPath(import.meta.url)),
		managedDir: deps.managedDir ?? getManagedDir(),
		repoRoot: deps.repoRoot ?? process.cwd(),
		npmRootGlobal: deps.npmRootGlobal ?? (() => npm.rootGlobalOr("")),
		which: deps.which ?? which,
		floor,
		currentSpawnPath: current.ok ? current.path : null,
	});

	const spawn = consumerOf(registry, PI_SPAWN_TOOL, candidates);
	const module = consumerOf(registry, PI_MODULE_TOOL, candidates);

	// Both consumers must land on the SAME install. Unresolvable on either
	// side is not "in sync" — there is nothing to agree about.
	const inSync = samePackageDir(spawn.pkgDir, module.pkgDir);
	const setDivergence = piVersionDivergence(
		candidates.map((c) => ({
			location: c.key,
			resolvedPath: c.pkgDir,
			version: c.version,
		})),
	);

	return {
		candidates,
		spawn,
		module,
		inSync,
		// Divergence requires KNOWING both sides differ. An unresolvable or
		// package-dir-less consumer is "unknown", not "diverged" — reporting a
		// mismatch we cannot substantiate would make the banner untrustworthy.
		consumerDiverged: Boolean(spawn.pkgDir && module.pkgDir) && !inSync,
		installSetDiverged: setDivergence.diverged,
		installSetVersions: setDivergence.versions,
		floor,
	};
}

/** Human-readable divergence message naming BOTH versions (design D5). */
export function consumerDivergenceMessage(
	snap: PiRuntimeSnapshot,
): string | null {
	if (!snap.consumerDiverged) return null;
	const s = snap.spawn.version ?? "unknown";
	const m = snap.module.version ?? "unknown";
	return `pi runtime mismatch: sessions spawn pi ${s} while the server imports pi ${m}.`;
}

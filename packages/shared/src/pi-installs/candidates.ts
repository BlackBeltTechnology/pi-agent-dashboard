/**
 * Pi candidate enumeration — the discovery half of the runtime picker.
 *
 * Mirrors the locations `piExecutorDef`'s strategy chain walks (design D2), so
 * "what you can pick" and "what can be resolved" stay the same set:
 *   bare-import anchor · managed dir · npm-global prefix · repo-root
 * plus a read-only `current` candidate when the live resolution matches none
 * of them (D10).
 *
 * Each candidate carries PER-CONSUMER ENTRY FILES, never a directory (D2a):
 * `spawnEntry` (`dist/cli.js`, written to the `pi` override) and `moduleEntry`
 * (`dist/index.js`, written to the `pi-coding-agent` override). A directory is
 * illegal for both consumers — `EACCES` on spawn, `ERR_UNSUPPORTED_DIR_IMPORT`
 * on import.
 *
 * Version probing is filesystem-only: **no `pi --version` is ever spawned**
 * (D3). Locating some candidates is not spawn-free (`npm root -g`, PATH
 * lookup), so enumeration carries its own cache invalidated by the same
 * `rescan()` that invalidates the registry.
 *
 * See change: select-pi-runtime-install.
 */

import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { readPkgVersion } from "./installs.js";
import { isBelow } from "./versions.js";

/** Package aliases probed at every location, upstream-first (chain order). */
export const PI_PKG_ALIASES = [
	"@earendil-works/pi-coding-agent",
	"@mariozechner/pi-coding-agent",
] as const;

/** Entry the `pi` executor override must point at. */
export const PI_SPAWN_ENTRY = path.join("dist", "cli.js");
/** Entry the `pi-coding-agent` module override must point at. */
export const PI_MODULE_ENTRY = path.join("dist", "index.js");

/** Stable keys for the four derived locations plus the two dynamic ones. */
export type PiCandidateKey =
	| "bare-import"
	| "managed"
	| "npm-global"
	| "repo-root"
	| "path"
	| "current";

export interface PiCandidate {
	key: PiCandidateKey;
	label: string;
	/** Package directory, or null when this location holds no pi. */
	pkgDir: string | null;
	/** File the `pi` override would be set to, or null. */
	spawnEntry: string | null;
	/** File the `pi-coding-agent` override would be set to, or null. */
	moduleEntry: string | null;
	/** Declared version from package.json, or null when unreadable. */
	version: string | null;
	/**
	 * False ONLY when the version is known AND below the floor. An unknown
	 * version is never floor-gated (D6) — it stays selectable, with a warning.
	 */
	meetsFloor: boolean;
	/** True when the version could not be read, so no floor check was possible. */
	floorUnknown: boolean;
	/** True for the synthesised `current` row — displayed, never a pin target. */
	readOnly?: boolean;
}

export interface EnumerateDeps {
	exists?(p: string): boolean;
	isDirectory?(p: string): boolean;
	readVersion?(pkgJsonPath: string): string | null;
	/** `npm root -g`; may throw or return "" — enumeration degrades (X11). */
	npmRootGlobal?(): string;
	which?(name: string): string | null;
	realpath?(p: string): string;
	/** Directory the bare-import dir-walk starts from. */
	anchorDir?: string;
	managedDir?: string;
	repoRoot?: string;
	/** Compatibility floor; null disables gating. */
	floor?: string | null;
	/** The path the `pi` chain currently resolves to, for the `current` row. */
	currentSpawnPath?: string | null;
}

interface Resolved extends Required<Omit<EnumerateDeps, "floor" | "currentSpawnPath" | "anchorDir" | "managedDir" | "repoRoot">> {
	floor: string | null;
	currentSpawnPath: string | null;
	anchorDir: string | undefined;
	managedDir: string | undefined;
	repoRoot: string | undefined;
}

function withDefaults(deps: EnumerateDeps = {}): Resolved {
	return {
		exists: deps.exists ?? existsSync,
		isDirectory:
			deps.isDirectory ??
			((p) => {
				try {
					return statSync(p).isDirectory();
				} catch {
					return false;
				}
			}),
		readVersion: deps.readVersion ?? readPkgVersion,
		npmRootGlobal: deps.npmRootGlobal ?? (() => ""),
		which: deps.which ?? (() => null),
		realpath:
			deps.realpath ??
			((p) => {
				try {
					return realpathSync(p);
				} catch {
					return p;
				}
			}),
		anchorDir: deps.anchorDir,
		managedDir: deps.managedDir,
		repoRoot: deps.repoRoot,
		floor: deps.floor ?? null,
		currentSpawnPath: deps.currentSpawnPath ?? null,
	};
}

/** Probe both aliases under `<base>/node_modules`, upstream-first. */
function probeNodeModules(base: string, d: Resolved): string | null {
	for (const alias of PI_PKG_ALIASES) {
		const pkgDir = path.join(base, "node_modules", alias);
		if (d.exists(path.join(pkgDir, "package.json"))) return pkgDir;
	}
	return null;
}

/** Probe both aliases directly under `<root>` (npm-global root layout). */
function probeRoot(root: string, d: Resolved): string | null {
	for (const alias of PI_PKG_ALIASES) {
		const pkgDir = path.join(root, alias);
		if (d.exists(path.join(pkgDir, "package.json"))) return pkgDir;
	}
	return null;
}

/** Walk up from `start` looking for `node_modules/<alias>/package.json`. */
function probeByDirWalk(start: string, d: Resolved): string | null {
	let dir = start;
	for (let i = 0; i < 64; i += 1) {
		const hit = probeNodeModules(dir, d);
		if (hit) return hit;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/** Build a candidate row from a package directory (or an absent location). */
function makeCandidate(
	key: PiCandidateKey,
	label: string,
	pkgDir: string | null,
	d: Resolved,
): PiCandidate {
	if (!pkgDir) {
		return {
			key,
			label,
			pkgDir: null,
			spawnEntry: null,
			moduleEntry: null,
			version: null,
			meetsFloor: true,
			floorUnknown: true,
		};
	}
	const version = d.readVersion(path.join(pkgDir, "package.json"));
	const spawn = path.join(pkgDir, PI_SPAWN_ENTRY);
	const mod = path.join(pkgDir, PI_MODULE_ENTRY);
	return {
		key,
		label,
		pkgDir,
		// Entries are FILES or null — never a directory (D2a / E4).
		spawnEntry: d.exists(spawn) && !d.isDirectory(spawn) ? spawn : null,
		moduleEntry: d.exists(mod) && !d.isDirectory(mod) ? mod : null,
		version,
		...floorFlags(version, d.floor),
	};
}

function floorFlags(
	version: string | null,
	floor: string | null,
): { meetsFloor: boolean; floorUnknown: boolean } {
	if (!version) return { meetsFloor: true, floorUnknown: true };
	if (!floor) return { meetsFloor: true, floorUnknown: false };
	return { meetsFloor: !isBelow(version, floor), floorUnknown: false };
}

/**
 * Walk from an entry file to its package directory: `<pkgDir>/dist/cli.js` →
 * `<pkgDir>`. Realpaths first so a symlinked bin launcher lands on the real
 * module dir — the same walk `readCurrentPiVersion` performs (D10).
 */
export function pkgDirForEntry(
	entryPath: string,
	deps: EnumerateDeps = {},
): string | null {
	const d = withDefaults(deps);
	const real = d.realpath(entryPath);
	const up = path.dirname(path.dirname(real));
	return d.exists(path.join(up, "package.json")) ? up : null;
}

/** True when two paths denote the same install after realpath. */
export function samePackageDir(
	a: string | null | undefined,
	b: string | null | undefined,
	deps: EnumerateDeps = {},
): boolean {
	if (!a || !b) return false;
	const d = withDefaults(deps);
	return path.resolve(d.realpath(a)) === path.resolve(d.realpath(b));
}

/**
 * Process-wide enumeration cache.
 *
 * Deliberately NOT keyed on `deps`: the two production callers
 * (`/api/health`'s divergence snapshot and the `/api/pi/installs` route) both
 * compose the SAME live locations through `piRuntimeSnapshot`, so one entry is
 * the whole answer. The consequence is explicit rather than hidden: a warm
 * cache is returned BEFORE `deps` is read, so a caller passing different `deps`
 * gets the previous composition. Tests therefore call
 * `invalidatePiCandidatesCache()` in `beforeEach`, and any future caller with a
 * genuinely different composition must key this cache rather than rely on
 * callers converging by luck.
 */
let cache: PiCandidate[] | null = null;

/**
 * Drop the enumeration cache. Wired into the registry `rescan()` path so a
 * selection or an on-disk change is reflected on the next enumeration (E10).
 */
export function invalidatePiCandidatesCache(): void {
	cache = null;
}

/**
 * Enumerate every pi install the strategy chain could reach.
 *
 * The four derived locations are ALWAYS present, even when empty (E2) — an
 * absent location is a row with null paths, not an omission, so the UI can say
 * "managed: not installed" rather than silently hiding it.
 */
export function enumeratePiCandidates(deps: EnumerateDeps = {}): PiCandidate[] {
	if (cache) return cache;
	const d = withDefaults(deps);
	const out: PiCandidate[] = [];

	out.push(
		makeCandidate(
			"bare-import",
			"Bundled (bare import)",
			d.anchorDir ? probeByDirWalk(d.anchorDir, d) : null,
			d,
		),
	);
	out.push(
		makeCandidate(
			"managed",
			"Managed install",
			// The managed dir itself has no pi package.json — the install lives
			// under its node_modules (E3). The dir is supplied by the caller.
			d.managedDir ? probeNodeModules(d.managedDir, d) : null,
			d,
		),
	);

	let npmRoot = "";
	try {
		npmRoot = d.npmRootGlobal() || "";
	} catch {
		// `npm root -g` failed — the npm-global location degrades to absent and
		// every other candidate is still returned (X11).
		npmRoot = "";
	}
	out.push(
		makeCandidate(
			"npm-global",
			"npm global",
			npmRoot ? probeRoot(npmRoot, d) : null,
			d,
		),
	);

	out.push(
		makeCandidate(
			"repo-root",
			"Repo node_modules",
			d.repoRoot ? probeNodeModules(d.repoRoot, d) : null,
			d,
		),
	);

	// PATH executable with no adjacent package.json (Windows `.cmd` shim shape):
	// selectable, version unknown, never floor-gated (E7).
	const onPath = safeWhich(d);
	if (onPath && !pkgDirForEntry(onPath, deps)) {
		out.push({
			key: "path",
			label: "On PATH",
			pkgDir: null,
			spawnEntry: onPath,
			moduleEntry: null,
			version: null,
			meetsFloor: true,
			floorUnknown: true,
		});
	}

	// The live resolution, when it matches no enumerated location (E8/D10).
	if (d.currentSpawnPath) {
		const currentDir = pkgDirForEntry(d.currentSpawnPath, deps);
		const known = out.some((c) => samePackageDir(c.pkgDir, currentDir, deps));
		if (!known) {
			const row = makeCandidate(
				"current",
				"Currently resolved",
				currentDir,
				d,
			);
			// A bare binary with no package dir still has a spawn entry: itself.
			out.push({
				...row,
				spawnEntry: row.spawnEntry ?? d.currentSpawnPath,
				readOnly: true,
			});
		}
	}

	cache = out;
	return out;
}

function safeWhich(d: Resolved): string | null {
	try {
		return d.which("pi");
	} catch {
		return null;
	}
}

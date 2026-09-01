/**
 * Node installation candidate enumeration — the discovery half of the
 * Node family picker. The `pi-installs` module is the structural
 * exemplar; the differences are the ones that matter:
 *
 * - Roots: every root the node/npm/npx strategy chains probe (bundled
 *   `<resourcesPath>/node`, managed `<managedDir>/node`, PATH) MUST be
 *   enumerated when present (one-directional mirror — the chains cannot
 *   drift away from the picker), PLUS version-manager roots (nvm, fnm,
 *   volta, asdf) which are additive by scope decision 0.2 — the chains
 *   do not walk them; the picker makes them resolvable by writing
 *   overrides (see `select.ts`).
 * - Version is filesystem-only and OPTIONAL (design D4): encoded in the
 *   version dir name for version-manager installs, absent otherwise.
 *   **No `node --version` is ever spawned.** The `spawn` dep exists as a
 *   test tripwire only and MUST NOT be called.
 * - Entries are per-member FILES (`nodeEntry`, `npmEntry`, `npxEntry`),
 *   never a directory — a directory is not a legal spawn target, and a
 *   partial installation (distro nodejs without npm) surfaces as a
 *   candidate with the member entry absent, never discarded or
 *   fabricated.
 *
 * Enumeration carries its own cache invalidated by the same
 * `registry.rescan()` signal that invalidates the registry and the pi
 * candidates cache.
 *
 * See change: add-node-runtime-family-selection.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import path from "node:path";
import {
	scanVersionManagerInstalls,
	type VmInstallDir,
} from "./vm-roots.js";

export { versionFromDirName } from "./vm-roots.js";
export type { VmInstallDir } from "./vm-roots.js";

/** Stable keys for the derived chain roots plus the version-manager roots. */
export const NODE_CANDIDATE_KEYS = [
	"bundled",
	"managed",
	"path",
	"nvm",
	"fnm",
	"volta",
	"asdf",
] as const;

export type NodeCandidateKey = (typeof NODE_CANDIDATE_KEYS)[number];

export interface NodeCandidate {
	key: NodeCandidateKey;
	label: string;
	/** Installation root; null when this location holds no Node. */
	root: string | null;
	/** File the `node` override would be set to, or null. */
	nodeEntry: string | null;
	/** File the `npm` override would be set to, or null. */
	npmEntry: string | null;
	/** File the `npx` override would be set to, or null. */
	npxEntry: string | null;
	/**
	 * Version from filesystem metadata, or null when no filesystem
	 * source encodes it. Never obtained by spawning.
	 */
	version: string | null;
}

export interface EnumerateNodeDeps {
	exists?(p: string): boolean;
	isDirectory?(p: string): boolean;
	readDir?(p: string): string[];
	which?(name: string): string | null;
	homedir?: string;
	platform?: NodeJS.Platform;
	/** Electron Resources/ dir; bundled-root candidates fast-fail when unset. */
	resourcesPath?: string;
	/** Managed dir root (supplied by the caller via getManagedDir()); managed root fast-fails when unset. */
	managedDir?: string;
	/**
	 * SPAWN TRIWIRE — the enumeration contract forbids spawning. Tests
	 * inject a throwing implementation and assert it is never called;
	 * the implementation must not invoke it.
	 */
	spawn?: (...args: unknown[]) => unknown;
}

interface Resolved {
	exists(p: string): boolean;
	isDirectory(p: string): boolean;
	readDir(p: string): string[];
	which(name: string): string | null;
	homedir: string;
	platform: NodeJS.Platform;
	resourcesPath?: string;
	managedDir?: string;
}

function withDefaults(deps: EnumerateNodeDeps = {}): Resolved {
	const home = deps.homedir ?? osHomedir();
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
		readDir: deps.readDir ?? ((p) => readdirSync(p)),
		which: deps.which ?? (() => null),
		homedir: home,
		platform: deps.platform ?? process.platform,
		resourcesPath: deps.resourcesPath,
		managedDir: deps.managedDir,
	};
}

/**
 * Per-member entry files for an installation root (design D3 table).
 * Unix: everything under `bin/`; Windows: `node.exe` + `npm.cmd` +
 * `npx.cmd` at the root. Each member probed INDEPENDENTLY — a miss
 * leaves that entry null (partial families are legal).
 */
function probeEntries(
	root: string,
	d: Resolved,
	layout: "bin-subdir" | "root-is-bin" = "bin-subdir",
): Pick<NodeCandidate, "nodeEntry" | "npmEntry" | "npxEntry"> {
	const names: Array<[keyof Pick<NodeCandidate, "nodeEntry" | "npmEntry" | "npxEntry">, string]> =
		d.platform === "win32"
			? [
					["nodeEntry", "node.exe"],
					["npmEntry", "npm.cmd"],
					["npxEntry", "npx.cmd"],
				]
			: [
					["nodeEntry", "node"],
					["npmEntry", "npm"],
					["npxEntry", "npx"],
				];
	// Unix bundled/managed/version-manager installs keep binaries under
	// bin/; a PATH-resolved installation's root IS the bin dir (dirname of
	// the which() hit), so entries sit beside the binary.
	const dir = layout === "root-is-bin" || d.platform === "win32" ? root : path.join(root, "bin");
	const out: Pick<NodeCandidate, "nodeEntry" | "npmEntry" | "npxEntry"> = {
		nodeEntry: null,
		npmEntry: null,
		npxEntry: null,
	};
	for (const [field, name] of names) {
		const candidate = path.join(dir, name);
		// Entries are FILES or null — never a directory.
		if (d.exists(candidate) && !d.isDirectory(candidate)) out[field] = candidate;
	}
	return out;
}

function makeCandidate(
	key: NodeCandidateKey,
	label: string,
	root: string | null,
	version: string | null,
	d: Resolved,
	layout: "bin-subdir" | "root-is-bin" = "bin-subdir",
): NodeCandidate {
	if (!root) {
		return {
			key,
			label,
			root: null,
			nodeEntry: null,
			npmEntry: null,
			npxEntry: null,
			version: null,
		};
	}
	return {
		key,
		label,
		root,
		version,
		...probeEntries(root, d, layout),
	};
}

/**
 * Process-wide enumeration cache. Same shape and caveat as the pi
 * candidates cache: NOT keyed on deps — production callers compose the
 * same live locations; tests call `invalidateNodeCandidatesCache()` in
 * `beforeEach`.
 */
let cache: NodeCandidate[] | null = null;

/**
 * Drop the enumeration cache. Wired into the registry `rescan()` path so
 * a selection or an on-disk change is reflected on the next enumeration.
 */
export function invalidateNodeCandidatesCache(): void {
	cache = null;
}

/**
 * Enumerate every Node installation the picker can offer: the roots the
 * family strategy chains probe (bundled, managed, PATH — the mirror is
 * one-directional: these MUST be enumerated when present) plus the
 * version-manager roots (additive, scope decision 0.2).
 *
 * Every derived location yields a row even when absent, so the UI can
 * say "managed: not installed" rather than hiding it.
 */
export function enumerateNodeCandidates(deps: EnumerateNodeDeps = {}): NodeCandidate[] {
	if (cache) return cache;
	const d = withDefaults(deps);
	const out: NodeCandidate[] = [];

	// 1. Electron-bundled runtime at <resourcesPath>/node — the bundled-node
	//    strategy's root.
	out.push(
		makeCandidate(
			"bundled",
			"Bundled (Electron)",
			d.resourcesPath ? path.join(d.resourcesPath, "node") : null,
			null,
			d,
		),
	);

	// 2. Managed runtime at <managedDir>/node — managedRuntimeStrategy's root.
	out.push(
		makeCandidate(
			"managed",
			"Managed runtime",
			d.managedDir ? path.join(d.managedDir, "node") : null,
			null,
			d,
		),
	);

	// 3. PATH-resolved installation — dirname of which("node"); the root IS
	//    the bin dir, entries sit beside the binary.
	const onPath = safeWhich(d);
	out.push(
		makeCandidate(
			"path",
			"On PATH",
			onPath ? path.dirname(onPath) : null,
			null,
			d,
			"root-is-bin",
		),
	);

	// 4. Version-manager installations (additive; scope decision 0.2).
	const vmInstalls: VmInstallDir[] = scanVersionManagerInstalls({
		homedir: d.homedir,
		platform: d.platform,
		isDirectory: d.isDirectory,
		readDir: d.readDir,
	});
	for (const key of ["nvm", "fnm", "volta", "asdf"] as const) {
		const installs = vmInstalls.filter((v) => v.key === key);
		if (installs.length === 0) {
			out.push(makeCandidate(key, key, null, null, d));
			continue;
		}
		for (const install of installs) {
			out.push(
				makeCandidate(
					key,
					key,
					install.root,
					// Version encoded in the dir name (design D4); null otherwise.
					install.version,
					d,
				),
			);
		}
	}

	cache = out;
	return out;
}

function safeWhich(d: Resolved): string | null {
	try {
		return d.which("node");
	} catch {
		return null;
	}
}

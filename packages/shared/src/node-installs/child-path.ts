/**
 * Selection-aware child-PATH construction (design D7).
 *
 * Consumer classes after this change:
 * - pi-session spawns: governed by the landed spawn-runtime ladder; the
 *   selection is its gated step-1 candidate. NOT this helper.
 * - dashboard-tooling spawns: THIS helper — the SELECTED installation's
 *   bin dir is prepended; the managed runtime is NOT prepended ahead of
 *   it. With no selection (or a broken one) the behaviour is
 *   byte-identical to the legacy managed prepend.
 * - managed-tree mutations (pi-core-updater): keep managed-first — must
 *   NOT use this helper.
 *
 * Pure like its legacy sibling: never mutates `process.env`, returns a
 * distinct cloned env object.
 *
 * See change: add-node-runtime-family-selection.
 */
import path from "node:path";
import type { ToolRegistry } from "../tool-registry/index.js";
import { getDefaultRegistry } from "../tool-registry/index.js";
import type { ManagedPathsEnv } from "../managed-paths.js";
import { prependManagedNodeToPath } from "../platform/managed-node-path.js";

/** Minimal registry surface (structural — tests inject fakes). */
interface RegistryLike {
	listOverrides(): Readonly<Record<string, string>>;
	resolve(name: string): { ok: boolean; path: string | null; source?: string | null };
}

export interface ChildPathDeps {
	registry?: RegistryLike;
	/** Environment override for the legacy managed-dir resolution (tests). */
	managedPathsEnv?: ManagedPathsEnv;
}

/**
 * The selected installation's bin dir, or null when there is no
 * selection (no `node` override) or the selection is broken (override
 * set but the registry cannot resolve it) — null falls back to the
 * legacy managed prepend.
 */
function selectedBinDir(registry: RegistryLike): string | null {
	if (!registry.listOverrides().node) return null;
	const r = registry.resolve("node");
	// The selection must actually be HONOURED: a broken override falls
	// through the chain to bundled/managed/where, and prepending THAT dir
	// would silently repin children against the user's stale pin. Fall
	// back to the legacy managed prepend instead (spec 4.2b).
	if (!r.ok || !r.path || r.source !== "override") return null;
	// dirname works for both layouts: `<root>/bin/node` → `<root>/bin`;
	// `<root>\node.exe` → `<root>`.
	return path.dirname(r.path);
}

export function prependSelectedNodeToPath(
	baseEnv: NodeJS.ProcessEnv = process.env,
	deps: ChildPathDeps = {},
): NodeJS.ProcessEnv {
	const registry = deps.registry ?? getDefaultRegistry();
	const selected = selectedBinDir(registry);
	if (!selected) {
		// No selection → legacy behaviour, byte-identical (spec 4.2).
		return prependManagedNodeToPath(baseEnv, deps.managedPathsEnv);
	}
	const cloned: NodeJS.ProcessEnv = { ...baseEnv };
	const currentPath = cloned.PATH ?? "";
	// Same duplicate-prepend guard as the managed helper.
	if (currentPath.split(path.delimiter).includes(selected)) return cloned;
	cloned.PATH = currentPath
		? `${selected}${path.delimiter}${currentPath}`
		: selected;
	return cloned;
}

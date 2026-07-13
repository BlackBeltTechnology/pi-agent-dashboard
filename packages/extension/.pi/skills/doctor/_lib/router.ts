/**
 * Doctor router — derives its symptom map and sweep DAG from module
 * front-matter, so adding a capability MD auto-registers it with NO router
 * edit. The router owns NO capability knowledge (prevents a second rot
 * surface); everything comes from the modules' `symptoms:`/`depends-on:` keys.
 *
 * See change: add-modular-doctor-skill (design.md D1, spec: Modular router).
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type ModuleFrontMatter, parseFrontMatter } from "./front-matter.js";

export interface DoctorModule extends ModuleFrontMatter {
	/** Absolute path to the module MD. */
	file: string;
}

/**
 * Load every capability MD in `modulesDir` (excluding `_`-prefixed helpers)
 * and parse its front-matter into a router catalog entry.
 */
export function loadModules(modulesDir: string): DoctorModule[] {
	const out: DoctorModule[] = [];
	for (const ent of readdirSync(modulesDir, { withFileTypes: true })) {
		if (!ent.isFile()) continue;
		if (!ent.name.endsWith(".md")) continue;
		if (ent.name.startsWith("_")) continue;
		const file = path.join(modulesDir, ent.name);
		const md = readFileSync(file, "utf8");
		const base = ent.name.replace(/\.md$/, "");
		out.push({ ...parseFrontMatter(md, base), file });
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build the symptom→module map from each module's `symptoms:` phrases.
 * Later modules do not clobber earlier ones (first declaration wins), keeping
 * routing deterministic under alphabetical load order.
 */
export function buildSymptomMap(modules: DoctorModule[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const m of modules) {
		for (const phrase of m.symptoms) {
			const key = normalizePhrase(phrase);
			if (key && !map.has(key)) map.set(key, m.name);
		}
	}
	return map;
}

/**
 * Normalise a phrase for matching: lower-case, strip punctuation (so "won't"
 * ≡ "wont"), collapse whitespace. Keeps routing robust to apostrophes and
 * underscores (`waiting_peers`).
 */
function normalizePhrase(s: string): string {
	return s
		.toLowerCase()
		.replace(/['’]/g, "") // drop apostrophes: won't ≡ wont
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

/**
 * Route a free-text symptom phrase to exactly one module id, or null.
 * Matches on whole-phrase equality first, then substring containment in
 * either direction (so "flow won't show" matches a declared "flow won't
 * show up" and vice-versa). Matching is punctuation-insensitive.
 */
export function routeSymptom(modules: DoctorModule[], phrase: string): string | null {
	const q = normalizePhrase(phrase);
	if (!q) return null;
	const map = buildSymptomMap(modules);
	if (map.has(q)) return map.get(q) ?? null;
	for (const [decl, id] of map) {
		if (q.includes(decl) || decl.includes(q)) return id;
	}
	return null;
}

/**
 * Topologically order modules by their `depends-on:` edges (env → pi → peers
 * → plugins → build → runtime). Ties break alphabetically for determinism.
 * Throws on a dependency cycle.
 */
export function buildSweepOrder(modules: DoctorModule[]): string[] {
	const byName = new Map(modules.map((m) => [m.name, m]));
	const order: string[] = [];
	const visited = new Set<string>();
	const inStack = new Set<string>();

	const visit = (name: string) => {
		if (visited.has(name)) return;
		if (inStack.has(name)) {
			throw new Error(`doctor: dependency cycle at module '${name}'`);
		}
		inStack.add(name);
		const mod = byName.get(name);
		const deps = mod ? [...mod.dependsOn].sort() : [];
		for (const d of deps) {
			if (byName.has(d)) visit(d);
		}
		inStack.delete(name);
		visited.add(name);
		order.push(name);
	};

	for (const m of [...modules].sort((a, b) => a.name.localeCompare(b.name))) {
		visit(m.name);
	}
	return order;
}

export interface SweepStep {
	module: string;
	/** True when a (transitive) dependency failed, so this step is skipped. */
	suppressed: boolean;
	/** The failed dependency that caused suppression (root cause). */
	suppressedBy?: string;
}

/**
 * Plan a full sweep: order modules by dependency, then mark every module whose
 * transitive dependency is in `failed` as suppressed so a lower-layer failure
 * (missing pi) is reported as the root cause and NOT re-reported as a broken
 * bridge. `failed` is the set of module ids known to have failed this run.
 */
export function planSweep(modules: DoctorModule[], failed: Set<string>): SweepStep[] {
	const byName = new Map(modules.map((m) => [m.name, m]));
	const order = buildSweepOrder(modules);
	// Resolve the transitive dependency that failed, closest root first.
	const rootFailure = new Map<string, string>();
	for (const name of order) {
		const mod = byName.get(name);
		if (!mod) continue;
		for (const dep of mod.dependsOn) {
			if (failed.has(dep)) {
				rootFailure.set(name, dep);
				break;
			}
			if (rootFailure.has(dep)) {
				rootFailure.set(name, rootFailure.get(dep) as string);
				break;
			}
		}
	}
	return order.map((name) => {
		const by = rootFailure.get(name);
		return by
			? { module: name, suppressed: true, suppressedBy: by }
			: { module: name, suppressed: false };
	});
}

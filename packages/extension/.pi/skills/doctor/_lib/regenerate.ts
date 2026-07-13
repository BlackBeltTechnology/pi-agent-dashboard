/**
 * Regenerate / drift-check the per-module `<id>.knowledge.hash` sidecars.
 *
 * Usage (from the doctor skill dir):
 *   tsx _lib/regenerate.ts --check            # report drift for every module
 *   tsx _lib/regenerate.ts --write            # (re)write every sidecar
 *   tsx _lib/regenerate.ts --write <module>   # rewrite one module's sidecar
 *
 * `--write` reconciles the DERIVED tables (the hash sidecar). It never edits a
 * module's authored prose — that is proposed for confirmation by the agent
 * running the doctor `--regenerate <module>` flow (SKILL.md).
 *
 * See change: add-modular-doctor-skill (design.md D6, tasks 4.1–4.3).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveLiveTokens, MODULE_TOKEN_SOURCES } from "./derive-tokens.js";
import { checkDrift, computeKnowledgeHash, writeStoredHash } from "./knowledge-hash.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULES_DIR = path.join(HERE, "..", "modules");

/** Absolute path to a module's hash sidecar. */
export function hashPathFor(moduleId: string): string {
	return path.join(MODULES_DIR, `${moduleId}.knowledge.hash`);
}

/**
 * Discover the repo root by walking up from `start` until a directory with a
 * `packages/` workspace dir is found. Returns null when none is found (e.g. a
 * published-tarball layout without the monorepo).
 */
export function findRepoRoot(start: string): string | null {
	let dir = start;
	for (let i = 0; i < 12; i++) {
		// packages/ + a root package.json marks the monorepo root.
		if (existsSync(path.join(dir, "packages")) && existsSync(path.join(dir, "package.json"))) {
			return dir;
		}
		const up = path.dirname(dir);
		if (up === dir) break;
		dir = up;
	}
	return null;
}

export interface RegenReport {
	module: string;
	stored: string | null;
	live: string;
	drifted: boolean;
}

/** Compute drift for every module under `repoRoot`. */
export function reportDrift(repoRoot: string): RegenReport[] {
	return Object.keys(MODULE_TOKEN_SOURCES)
		.sort()
		.map((id) => {
			const tokens = deriveLiveTokens(repoRoot, id);
			const d = checkDrift(id, tokens, hashPathFor(id));
			return { module: id, stored: d.stored, live: d.live, drifted: d.drifted };
		});
}

/** (Re)write one or all module sidecars from live sources. */
export function writeHashes(repoRoot: string, only?: string): string[] {
	const ids = only ? [only] : Object.keys(MODULE_TOKEN_SOURCES).sort();
	const written: string[] = [];
	for (const id of ids) {
		const hash = computeKnowledgeHash(deriveLiveTokens(repoRoot, id));
		writeStoredHash(hashPathFor(id), hash);
		written.push(id);
	}
	return written;
}

// CLI entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	const repoRoot = findRepoRoot(HERE);
	if (!repoRoot) {
		console.error("doctor regenerate: repo root not found (published tarball?)");
		process.exit(2);
	}
	if (args.includes("--write")) {
		const only = args.find((a) => !a.startsWith("--"));
		const written = writeHashes(repoRoot, only);
		console.log(`wrote ${written.length} sidecar(s): ${written.join(", ")}`);
	} else {
		let drift = false;
		for (const r of reportDrift(repoRoot)) {
			const mark = r.drifted ? "DRIFT" : "ok";
			if (r.drifted) drift = true;
			console.log(`${mark.padEnd(6)} ${r.module}  stored=${r.stored ?? "-"} live=${r.live}`);
		}
		process.exit(drift ? 1 : 0);
	}
}

/**
 * Two-tier self-update, tier-2: per-module knowledge-hash. Mirrors the
 * `PLUGIN_REGISTRY_HASH` pattern. The hash is computed over *semantic tokens*
 * extracted from a module's `derives-from` sources (peer names, the version
 * floor, manifest ids) — NOT raw file bytes — so a whitespace/refactor change
 * does not drift the hash but a peer rename does. A drift between the live
 * hash and the stored `<module>.knowledge.hash` flags the module's authored
 * prose as possibly stale and drives a confirmed `--regenerate <module>`.
 *
 * See change: add-modular-doctor-skill (design.md D6, spec: prose-drift).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Compute a stable hash over a set of semantic tokens. Tokens are trimmed,
 * lower-cased, de-duplicated and sorted so ordering / casing / whitespace
 * differences in the source do not drift the hash — only the *set* of
 * meaningful tokens does.
 */
export function computeKnowledgeHash(tokens: string[]): string {
	const norm = [...new Set(tokens.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort();
	return createHash("sha256").update(norm.join("\n")).digest("hex").slice(0, 16);
}

/**
 * Extract semantic tokens from a `derives-from` source's raw text: scoped and
 * unscoped package names, and semver strings (the version floor / carried
 * versions). Prose, whitespace, and comments contribute no tokens, so a
 * reformat leaves the hash stable while a peer rename or floor bump changes it.
 */
export function extractSemanticTokens(text: string): string[] {
	const tokens: string[] = [];
	// Scoped + unscoped npm package names (e.g. @scope/name, pi-flows).
	for (const m of text.matchAll(/@[a-z0-9-]+\/[a-z0-9-]+|\b[a-z][a-z0-9-]*-[a-z0-9-]+\b/gi)) {
		tokens.push(m[0]);
	}
	// Semver strings (floor, carried versions).
	for (const m of text.matchAll(/\b\d+\.\d+\.\d+\b/g)) {
		tokens.push(m[0]);
	}
	return tokens;
}

/** Read a stored `<module>.knowledge.hash` sidecar, or null when absent. */
export function readStoredHash(hashPath: string): string | null {
	if (!existsSync(hashPath)) return null;
	return readFileSync(hashPath, "utf8").trim() || null;
}

/** Write a `<module>.knowledge.hash` sidecar. */
export function writeStoredHash(hashPath: string, hash: string): void {
	writeFileSync(hashPath, `${hash}\n`);
}

export interface DriftResult {
	module: string;
	stored: string | null;
	live: string;
	/** True when authored prose may be stale (hash mismatch or no sidecar). */
	drifted: boolean;
}

/**
 * Compare a module's live semantic hash against its stored sidecar.
 * `drifted` is true when they differ OR the sidecar is missing — either way
 * the authored prose has not been reconciled with the current sources.
 */
export function checkDrift(module: string, liveTokens: string[], hashPath: string): DriftResult {
	const live = computeKnowledgeHash(liveTokens);
	const stored = readStoredHash(hashPath);
	return { module, stored, live, drifted: stored !== live };
}

/**
 * Maps each capability module to the concrete `derives-from` source files that
 * carry its semantic tokens (peer names, version floor, manifest ids), and
 * derives the live token set the knowledge-hash is computed over. Reading the
 * SOURCES (not the module prose) is what makes a source-of-truth change drift
 * the module's stored hash and flag its authored prose as stale.
 *
 * Paths are repo-root-relative so the same map works in a dev checkout and a
 * resolved workspace. Missing files contribute no tokens (a partial repo view
 * degrades, it does not throw).
 *
 * See change: add-modular-doctor-skill (design.md D6, spec: prose-drift).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { extractSemanticTokens } from "./knowledge-hash.js";

/** Module id → repo-root-relative source files carrying its semantic tokens. */
export const MODULE_TOKEN_SOURCES: Record<string, string[]> = {
	"env-node": ["packages/shared/src/node-version.ts"],
	"pi-resolution": ["packages/server/package.json"],
	peers: ["packages/flows-anthropic-bridge-plugin/src/peer-probe.ts"],
	"plugins-bridges": ["packages/shared/src/plugin-bridge-register.ts"],
	"build-reload": ["packages/extension/package.json"],
	"install-topology": ["packages/shared/src/dashboard-paths.ts"],
	"model-resolution": ["packages/extension/src/provider-register.ts"],
};

/**
 * Read a module's live `derives-from` source files under `repoRoot` and return
 * the extracted semantic tokens (deduped by `computeKnowledgeHash` downstream).
 */
export function deriveLiveTokens(repoRoot: string, moduleId: string): string[] {
	const sources = MODULE_TOKEN_SOURCES[moduleId] ?? [];
	const tokens: string[] = [];
	for (const rel of sources) {
		const abs = path.join(repoRoot, rel);
		if (!existsSync(abs)) continue;
		tokens.push(...extractSemanticTokens(readFileSync(abs, "utf8")));
	}
	return tokens;
}

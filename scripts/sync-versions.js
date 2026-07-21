#!/usr/bin/env node
/**
 * sync-versions.js — pi-agent-dashboard monorepo dep-specifier synchroniser
 *
 * After `npm version <ver> --workspaces --include-workspace-root` bumps every
 * package.json's `version` field, this script rewrites every inter-package
 * dependency specifier in the monorepo to `^<bumped-version>`. Without this
 * step, the published tarball's `dependencies` would remain pinned to the
 * previous version's range.
 *
 * This is required because npm's CLI does not implement the `workspace:`
 * protocol (pnpm/yarn-only), so we use plain semver caret ranges and
 * synchronise them manually at bump time.
 *
 * Usage:
 *   node scripts/sync-versions.js
 *
 * Invariants enforced:
 *   1. Lockstep versioning — every package.json in the monorepo (root +
 *      packages/*) shares the same `version` string. Violation → exit 1.
 *   2. No cross-package specifier may be `workspace:*` or similar — it must
 *      be a plain semver range that will be rewritten to `^<current-version>`.
 *
 * Specifier preservation:
 *   Any cross-package specifier that is NOT a parseable semver range (e.g.
 *   `"*"`, `"latest"`, `"github:owner/repo#sha"`, `"file:../foo"`, a
 *   `git+ssh://` URL, an `http(s)://` tarball URL) represents a deliberate
 *   human override (e.g. a hotfix pin while a dependent is mid-release).
 *   The script SHALL leave such specifiers unchanged AND emit a warning to
 *   stderr naming the dependent package.json, the dependency, and the
 *   preserved value, so a release reviewer can confirm intent.
 *
 * Ported from pi-mono (`scripts/sync-versions.js`, MIT, Mario Zechner).
 * Simplified to match this repo's layout (single `packages/` directory,
 * root package.json included in the lockstep set).
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isRewritableSemverSpec } from "./sync-versions-spec.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(repoRoot, "packages");

/**
 * Read and parse a package.json, returning { path, data } or null if the
 * file does not exist. Logs non-ENOENT errors. ENOENT is silent because some
 * directories under packages/ are build outputs, not workspaces.
 */
function readPkg(path, { required = false } = {}) {
	try {
		return { path, data: JSON.parse(readFileSync(path, "utf8")) };
	} catch (err) {
		if (err.code === "ENOENT" && !required) return null;
		console.error(`Failed to read ${path}: ${err.message}`);
		return null;
	}
}

// 1. Enumerate every package.json in the lockstep set.
const manifests = [];
const rootPkg = readPkg(join(repoRoot, "package.json"), { required: true });
if (!rootPkg) {
	console.error("Missing root package.json");
	process.exit(1);
}
manifests.push(rootPkg);

for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	const pkg = readPkg(join(packagesDir, entry.name, "package.json"));
	if (pkg) manifests.push(pkg);
}

// 2. Build the name → version map.
const versionMap = Object.create(null);
for (const { data } of manifests) {
	if (!data.name || !data.version) continue;
	versionMap[data.name] = data.version;
}

console.log("Current versions:");
for (const [name, version] of Object.entries(versionMap).sort()) {
	console.log(`  ${name}: ${version}`);
}

// 3. Lockstep invariant: every known package must share one version.
const distinctVersions = new Set(Object.values(versionMap));
if (distinctVersions.size > 1) {
	console.error("\n❌ ERROR: Lockstep invariant violated — not all packages share the same version.");
	console.error("   Run `npm version <ver> --workspaces --include-workspace-root` first.");
	process.exit(1);
}
console.log(`\n✅ Lockstep invariant OK (${[...distinctVersions][0]})`);

// 4. Rewrite inter-package dep specifiers (preserving non-semver overrides).
const depFields = ["dependencies", "devDependencies"];
let totalRewrites = 0;
let totalPreserved = 0;

for (const { path, data } of manifests) {
	let changed = false;

	for (const field of depFields) {
		const block = data[field];
		if (!block || typeof block !== "object") continue;

		for (const [depName, currentSpec] of Object.entries(block)) {
			if (!(depName in versionMap)) continue;

			const desired = `^${versionMap[depName]}`;
			if (currentSpec === desired) continue;

			if (!isRewritableSemverSpec(currentSpec)) {
				console.warn(
					`  ⚠️  preserving ${data.name} · ${field}.${depName}: ${currentSpec} ` +
						`(non-semver specifier; assumed deliberate override)`,
				);
				totalPreserved += 1;
				continue;
			}

			console.log(
				`  ${data.name} · ${field}.${depName}: ${currentSpec} → ${desired}`,
			);
			block[depName] = desired;
			changed = true;
			totalRewrites += 1;
		}
	}

	if (changed) {
		// Preserve 2-space indentation (matches existing style in this repo).
		writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
		console.log(`  ✎ wrote ${relative(repoRoot, path)}`);
	}
}

if (totalRewrites === 0 && totalPreserved === 0) {
	console.log("\nAll inter-package dependencies already in sync — no changes.");
} else {
	if (totalRewrites > 0) {
		console.log(`\n✅ Rewrote ${totalRewrites} inter-package dep specifier(s).`);
		console.log("   Note: pnpm-lock.yaml regeneration runs automatically");
		console.log("   in CI (publish.yml > tag-and-push > 'Regenerate pnpm-lock.yaml').");
		console.log("   For LOCAL bumps, run: pnpm install --lockfile-only");
	}
	if (totalPreserved > 0) {
		console.log(
			`\n⚠️  Preserved ${totalPreserved} non-semver specifier(s); review the warnings above to confirm intent.`,
		);
	}
}



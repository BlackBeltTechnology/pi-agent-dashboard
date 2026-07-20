#!/usr/bin/env node
/**
 * verify-lockfile-versions.mjs — sanity gate for the release prepare job.
 *
 * Walks pnpm-lock.yaml's `importers:` map and asserts every recorded
 * cross-ref dep specifier on a @blackbelt-technology/* workspace package
 * is exactly "^<current-root-version>". Exits non-zero with a per-mismatch
 * report if any specifier drifted.
 *
 * Runs immediately after `pnpm install --lockfile-only` in
 * `.github/workflows/publish.yml` (tag-and-push) and `_electron-build.yml`.
 *
 * Focused line parser (no YAML lib): pnpm-lock.yaml's `importers` block has a
 * fixed 2/4/6/8-space shape — importer path (2) → dependency section (4) →
 * dependency name (6) → `specifier:`/`version:` (8) — with no anchors. Same
 * lib-free rationale as publish-workflow-contract.test.ts.
 *
 * See changes: fix-release-lockfile-drift, adopt-pnpm-for-dev-ci (§6.6).
 */

import { readFileSync } from "node:fs";

const root = JSON.parse(readFileSync("package.json", "utf8"));
const expected = `^${root.version}`;
const lines = readFileSync("pnpm-lock.yaml", "utf8").split("\n");

const unquote = (s) => s.replace(/^['"]|['"]$/g, "");
const indentOf = (l) => l.length - l.trimStart().length;

const failures = [];
let inImporters = false;
let importer = null; // current importer path
let checkImporter = false; // is it a packages/* importer we verify
let pendingName = null; // last @blackbelt-technology/* dep name awaiting its specifier

for (const line of lines) {
	if (/^importers:\s*$/.test(line)) {
		inImporters = true;
		continue;
	}
	if (!inImporters) continue;

	// A new top-level (0-indent) key ends the importers block.
	if (line.length && !/^\s/.test(line)) break;

	const trimmed = line.trim();
	if (!trimmed) continue;
	const ind = indentOf(line);

	// Importer header: 2-space indent, ends with ':' (e.g. `.:`, `packages/client:`).
	if (ind === 2 && trimmed.endsWith(":")) {
		importer = unquote(trimmed.slice(0, -1));
		checkImporter = importer.startsWith("packages/");
		pendingName = null;
		continue;
	}
	if (!checkImporter) continue;

	// Dependency name: 6-space indent, ends with ':' (section headers are at 4).
	if (ind === 6 && trimmed.endsWith(":")) {
		const name = unquote(trimmed.slice(0, -1));
		pendingName = name.startsWith("@blackbelt-technology/") ? name : null;
		continue;
	}

	// specifier: 8-space indent, immediately under the dep name.
	if (ind === 8 && pendingName && trimmed.startsWith("specifier:")) {
		const spec = unquote(trimmed.slice("specifier:".length).trim());
		if (spec !== expected) {
			failures.push(`  ${importer} → ${pendingName}: ${spec} (expected ${expected})`);
		}
	}
}

if (failures.length) {
	console.error(
		"::error::Lockfile cross-ref drift detected. See change: fix-release-lockfile-drift.",
	);
	for (const line of failures) console.error(line);
	process.exit(1);
}

console.log(`✓ All cross-ref specifiers match ${expected}`);

/**
 * Repo-level invariant: the legacy `@mariozechner` pi fork is not referenced
 * anywhere in source, scripts, QA or root manifests. `@mariozechner/jiti` (a
 * different package, still mandated) is exempt.
 *
 * Mirrors the proposal's canonical gate:
 *   rg -nP 'mariozechner(?![\\/]jiti)' packages scripts qa tsconfig.base.json package.json
 *     (excluding node_modules / out / dist / *.md / scripts/ab-context)
 *
 * Allowed residue: lines asserting ABSENCE (`.not.`), the change id itself in
 * `See change:` notes, and the files below whose job is to name the fork
 * (forbidden-name gates and the fork-scenario regression tests).
 *
 * See change: drop-mariozechner-pi-fork (test-plan #E21).
 */
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const FORK_RE = /mariozechner(?![\\/]jiti)/;
const CHANGE_ID = "drop-mariozechner-pi-fork";

/** Repo-relative files allowed to name the fork, each with its reason. */
const ALLOWLIST: Readonly<Record<string, string>> = {
	// Historical jiti-baseline comment (names an old pi release).
	"packages/shared/src/platform/node-spawn.ts": "history comment",
	// Forbidden-name gate + its tests.
	"scripts/verify-release-deps.mjs": "FORBIDDEN_PI_PACKAGES",
	"scripts/__tests__/dependency-declarations.test.mjs": "forbidden-name assertions",
	// Fork-scenario regression tests: they install the fork as a fixture to
	// prove it is ignored.
	"packages/server/src/__tests__/pi-core-checker.test.ts": "fork fixture (E3–E5, X1)",
	"packages/server/src/__tests__/pi-core-routes.test.ts": "fork fixture (E6, E7)",
	"packages/server/src/__tests__/pi-version-skew-by-name.test.ts": "fork fixture (E15)",
	"packages/server/src/__tests__/package-manager-wrapper-resolve.test.ts": "fork fixture (E12, E13)",
	"packages/shared/src/__tests__/binary-lookup-resolveJiti.test.ts": "fork fixture (E8)",
	"packages/client/src/components/__tests__/UnifiedPackagesSection.test.tsx": "fork fixture (F1)",
	"packages/shared/src/__tests__/tool-registry-definitions.test.ts": "absence assertions (E11)",
	// This scan (seeded fixture string).
	"packages/shared/src/__tests__/no-legacy-pi-fork.test.ts": "the gate itself",
};

const SKIP_DIRS = new Set(["node_modules", "out", "dist", ".git"]);
const TEXT_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|sh|ps1|ya?ml|html|css)$/;

/** True when `line` carries a fork reference the gate rejects. */
export function isForkHit(line: string): boolean {
	if (line.includes(".not.")) return false; // negative assertion
	return FORK_RE.test(line.split(CHANGE_ID).join(""));
}

async function* walk(dir: string, repoRoot: string): AsyncGenerator<string> {
	let entries: import("node:fs").Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		const rel = path.relative(repoRoot, full).replace(/\\/g, "/");
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name) || rel === "scripts/ab-context") continue;
			yield* walk(full, repoRoot);
		} else if (entry.isFile() && TEXT_EXT.test(entry.name)) {
			yield full;
		}
	}
}

describe("no legacy pi fork references (E21)", () => {
	it("the matcher flags the fork and exempts jiti, negatives and the change id", () => {
		expect(isForkHit(`import x from "@mariozechner/pi-coding-agent";`)).toBe(true);
		expect(isForkHit(`"@mariozechner", "pi-coding-agent"`)).toBe(true);
		expect(isForkHit(`"@mariozechner/jiti"`)).toBe(false);
		expect(isForkHit(String.raw`node_modules\@mariozechner\jiti\package.json`)).toBe(false);
		expect(isForkHit(`expect(x).not.toContain("@mariozechner");`)).toBe(false);
		expect(isForkHit(`// See change: ${CHANGE_ID}.`)).toBe(false);
	});

	it("zero hits outside the allowlist", async () => {
		const here = path.dirname(url.fileURLToPath(import.meta.url));
		const repoRoot = path.resolve(here, "..", "..", "..", "..");
		const roots = ["packages", "scripts", "qa"].map((d) => path.join(repoRoot, d));
		const files: string[] = [];
		for (const r of roots) for await (const f of walk(r, repoRoot)) files.push(f);
		files.push(path.join(repoRoot, "tsconfig.base.json"), path.join(repoRoot, "package.json"));

		const hits: string[] = [];
		for (const file of files) {
			const rel = path.relative(repoRoot, file).replace(/\\/g, "/");
			if (rel in ALLOWLIST) continue;
			const lines = (await fs.readFile(file, "utf-8")).split(/\r?\n/);
			lines.forEach((line, i) => {
				if (isForkHit(line)) hits.push(`${rel}:${i + 1}  ${line.trim()}`);
			});
		}
		expect(hits, `Legacy fork references:\n${hits.join("\n")}`).toEqual([]);
	});
});

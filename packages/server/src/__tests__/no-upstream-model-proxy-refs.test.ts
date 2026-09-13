/**
 * Repo-surface guard: no product-facing reference to the upstream
 * npm extension may survive.
 *
 * Runs a repo-wide tracked-file search (task 6.1 semantics) and asserts every
 * remaining match is one of:
 *   - attribution/provenance text under `packages/server/src/model-proxy/convert/`
 *   - the historical `add-package-health-cleanup` proposal
 *   - a test fixture (negative assertions live in `__tests__/` + `*.test.*`)
 *   - a DOX `AGENTS.md` change-history row
 *   - this change's own tracking reference (the change id EMBEDS the upstream
 *     name, so every `See change: <id>` echo necessarily matches)
 *
 * Uses `git grep` (git is a hard dependency of this repo, unlike `rg`, which is
 * absent on the CI runner) over TRACKED files only — the same practical surface
 * the task-6.1 `rg` globs covered. The build-from-pieces needle keeps THIS file
 * out of its own match set.
 *
 * See change: remove-pi-model-proxy-upstream-references (E18).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"..",
);

// Assembled so the searched literal never appears in this file's own bytes.
const UPSTREAM = ["pi", "model", "proxy"].join("-");
const CHANGE_ID = ["remove", UPSTREAM, "upstream", "references"].join("-");

const GIT_ARGS = [
	"grep",
	"-n",
	"--no-color",
	UPSTREAM,
	"--",
	// Same exclusions as the task-6.1 command. `git grep` already skips
	// untracked/ignored paths (node_modules, dist, .git).
	":(exclude)pnpm-lock.yaml",
	":(exclude)openspec/changes/archive",
	":(exclude)openspec/specs",
	":(exclude)openspec/groups",
	":(exclude)docs/qa",
	":(exclude)Prompt stories",
	":(exclude)CHANGELOG.md",
];

interface Match {
	path: string;
	line: string;
}

function runSearch(): Match[] {
	let out = "";
	try {
		out = execFileSync("git", GIT_ARGS, { cwd: REPO_ROOT, encoding: "utf8" });
	} catch (e) {
		if ((e as { status?: number }).status === 1) return []; // git grep "no matches"
		throw e;
	}
	return out
		.split("\n")
		.filter(Boolean)
		.map((l) => {
			const i = l.indexOf(":");
			const j = l.indexOf(":", i + 1);
			return { path: l.slice(0, i), line: l.slice(j + 1) };
		});
}

const ATTRIBUTION_PREFIX = "packages/server/src/model-proxy/convert/";
const HISTORICAL_PROPOSAL = "openspec/changes/add-package-health-cleanup/proposal.md";
const RUNTIME_TESTS = "packages/dashboard-plugin-runtime/src/__tests__/";
const TEST_FILE_RE = /(^|\/)__tests__\/|\.test\./;

function isAllowed(m: Match): boolean {
	if (m.path.startsWith(ATTRIBUTION_PREFIX)) return true;
	if (m.path === "packages/server/src/model-proxy/UPSTREAM.md") return true;
	if (m.path === HISTORICAL_PROPOSAL) return true;
	if (m.path.startsWith(RUNTIME_TESTS)) return true;
	if (TEST_FILE_RE.test(m.path)) return true;
	// DOX change-history rows must name the change id to qualify; a stale
	// product mention in an AGENTS.md row without it still fails.
	if (m.line.includes(CHANGE_ID)) return true;
	return false;
}

describe("no upstream model-proxy references (E18)", () => {
	it("every remaining match is attribution, history, a test fixture, or change tracking", () => {
		const matches = runSearch();
		// Non-vacuous: the lifted-code attribution headers must still be found.
		expect(matches.some((m) => m.path.startsWith(ATTRIBUTION_PREFIX))).toBe(true);
		const unexpected = matches.filter((m) => !isAllowed(m));
		expect(unexpected).toEqual([]);
	});

	it("the migration guide is deleted", () => {
		expect(
			fs.existsSync(path.join(REPO_ROOT, "docs", "migration", `from-${UPSTREAM}.md`)),
		).toBe(false);
	});
});

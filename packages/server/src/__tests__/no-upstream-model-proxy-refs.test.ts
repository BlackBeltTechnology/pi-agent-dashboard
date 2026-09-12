/**
 * Repo-surface guard: no product-facing reference to the upstream
 * npm extension may survive.
 *
 * Runs the task-6.1 `rg` from the repo root with identical globs, then asserts
 * every remaining match is one of:
 *   - attribution/provenance text under `packages/server/src/model-proxy/convert/`
 *   - the historical `add-package-health-cleanup` proposal
 *   - a test fixture (negative assertions live in `__tests__/` + `*.test.*`)
 *   - a DOX `AGENTS.md` change-history row
 *   - this change's own tracking reference (the change id EMBEDS the upstream
 *     name, so every `See change: <id>` echo necessarily matches)
 *
 * The build-from-pieces needle keeps THIS file out of its own match set.
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

const RG_ARGS = [
	"-n",
	UPSTREAM,
	"--glob",
	"!node_modules",
	"--glob",
	"!pnpm-lock.yaml",
	"--glob",
	"!openspec/changes/archive/**",
	"--glob",
	"!openspec/specs/**",
	"--glob",
	"!openspec/groups/**",
	"--glob",
	"!docs/qa/**",
	"--glob",
	"!Prompt stories/**",
	"--glob",
	"!CHANGELOG.md",
	"--glob",
	`!openspec/changes/${CHANGE_ID}/**`,
	// Explicit search root: with a piped stdin rg would otherwise search stdin.
	".",
];

interface Match {
	path: string;
	line: string;
}

function runRg(): Match[] {
	let out = "";
	try {
		out = execFileSync("rg", RG_ARGS, { cwd: REPO_ROOT, encoding: "utf8" });
	} catch (e) {
		if ((e as { status?: number }).status === 1) return []; // rg "no matches"
		throw e;
	}
	return out
		.split("\n")
		.filter(Boolean)
		.map((l) => {
			const i = l.indexOf(":");
			const j = l.indexOf(":", i + 1);
			// `.` search root prefixes every path with `./`.
			return { path: l.slice(0, i).replace(/^\.\//, ""), line: l.slice(j + 1) };
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
	if (m.path.endsWith("AGENTS.md")) return true;
	if (m.line.includes(CHANGE_ID)) return true;
	return false;
}

describe("no upstream model-proxy references (E18)", () => {
	it("every remaining match is attribution, history, a test fixture, or change tracking", () => {
		const matches = runRg();
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

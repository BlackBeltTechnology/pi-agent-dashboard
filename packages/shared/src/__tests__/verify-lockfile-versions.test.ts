/**
 * `scripts/verify-lockfile-versions.mjs` gates the release: it asserts every
 * INTERNAL cross-ref specifier in pnpm-lock.yaml equals `^<root version>`.
 *
 * The bug this locks: "internal" was decided by NAME SCOPE
 * (`name.startsWith("@blackbelt-technology/")`), but the org publishes
 * packages that are NOT workspace members of this repo — e.g.
 * `@blackbelt-technology/pi-anthropic-messages`, an external dependency
 * pinned at `>=0.3.4`. The gate flagged it as drift and failed every
 * `tag-and-push` and `_electron-build` run. `scripts/sync-versions.js` had
 * it right all along (`if (!(depName in versionMap)) continue;`) — this
 * script now uses the same definition: membership in the workspace name set.
 *
 * Scope is NOT membership. Do not reintroduce a prefix test.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "verify-lockfile-versions.mjs");

const tmpDirs: string[] = [];
afterAll(() => {
	for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

/**
 * Build a throwaway repo: a root package.json at `version`, one workspace
 * package per `workspaces` entry, and a pnpm-lock.yaml whose single
 * `packages/pkg-a` importer declares `deps`.
 */
function scaffold(opts: {
	version: string;
	workspaces: string[];
	deps: Record<string, string>;
}): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-lockfile-"));
	tmpDirs.push(dir);

	fs.writeFileSync(
		path.join(dir, "package.json"),
		JSON.stringify({ name: "root", version: opts.version }, null, 2),
	);

	fs.mkdirSync(path.join(dir, "packages"), { recursive: true });
	for (const [i, name] of opts.workspaces.entries()) {
		const sub = path.join(dir, "packages", `w${i}`);
		fs.mkdirSync(sub, { recursive: true });
		fs.writeFileSync(
			path.join(sub, "package.json"),
			JSON.stringify({ name, version: opts.version }, null, 2),
		);
	}

	const depLines = Object.entries(opts.deps)
		.map(([n, spec]) => `      ${n}:\n        specifier: ${spec}\n        version: 1.0.0`)
		.join("\n");
	fs.writeFileSync(
		path.join(dir, "pnpm-lock.yaml"),
		`lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies: {}\n\n  packages/pkg-a:\n    dependencies:\n${depLines}\n\npackages: {}\n`,
	);
	return dir;
}

function run(cwd: string): { code: number; out: string } {
	try {
		const out = execFileSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" });
		return { code: 0, out };
	} catch (err) {
		const e = err as { status: number; stdout?: string; stderr?: string };
		return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
	}
}

describe("verify-lockfile-versions.mjs", () => {
	it("passes when a workspace cross-ref matches the root version", () => {
		const dir = scaffold({
			version: "9.9.9",
			workspaces: ["@blackbelt-technology/pi-dashboard-shared"],
			deps: { "@blackbelt-technology/pi-dashboard-shared": "^9.9.9" },
		});
		expect(run(dir).code).toBe(0);
	});

	it("FAILS when a workspace cross-ref drifted (the gate keeps its teeth)", () => {
		const dir = scaffold({
			version: "9.9.9",
			workspaces: ["@blackbelt-technology/pi-dashboard-shared"],
			deps: { "@blackbelt-technology/pi-dashboard-shared": "^1.2.3" },
		});
		const r = run(dir);
		expect(r.code).toBe(1);
		expect(r.out).toContain("pi-dashboard-shared");
	});

	it("ignores an org-scoped dep that is NOT a workspace member", () => {
		const dir = scaffold({
			version: "9.9.9",
			workspaces: ["@blackbelt-technology/pi-dashboard-shared"],
			deps: {
				"@blackbelt-technology/pi-dashboard-shared": "^9.9.9",
				// external, published independently — must not be treated as a cross-ref
				"@blackbelt-technology/pi-anthropic-messages": ">=0.3.4",
			},
		});
		const r = run(dir);
		expect(r.code, r.out).toBe(0);
	});

	it("still fails loudly when it matches zero specifiers (anti-vacuous guard)", () => {
		const dir = scaffold({
			version: "9.9.9",
			workspaces: ["@blackbelt-technology/pi-dashboard-shared"],
			deps: { "some-external-pkg": "^1.0.0" },
		});
		const r = run(dir);
		expect(r.code).toBe(1);
		expect(r.out).toContain("zero specifiers");
	});

	it("passes against the real repo lockfile", () => {
		const r = run(REPO_ROOT);
		expect(r.code, r.out).toBe(0);
	});
});

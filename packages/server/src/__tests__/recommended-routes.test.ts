/**
 * Tests for the GET /api/packages/recommended route and its helpers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Mock pi dependency (pulled transitively by package-manager-wrapper)
vi.mock("@earendil-works/pi-coding-agent", () => ({
	DefaultPackageManager: function () {
		return {};
	},
	SettingsManager: { create: () => ({}) },
}));

// Mock the npm-search-proxy so we can assert enrichment + failure paths.
// Only the two network fetchers are stubbed; pure helpers (deriveSkillIds) keep
// their real implementation — the route calls deriveSkillIds on the installed
// package.json, and a bare factory would leave it undefined.
vi.mock("../package/npm-search-proxy.js", async (importActual) => {
	const actual = await importActual<typeof import("../package/npm-search-proxy.js")>();
	return {
		...actual,
		fetchPackageMeta: vi.fn(),
		fetchGithubPackageJson: vi.fn(),
	};
});

import { RECOMMENDED_EXTENSIONS } from "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js";
import { fetchPackageMeta, fetchGithubPackageJson } from "../package/npm-search-proxy.js";
import {
	registerRecommendedRoutes,
	invalidateRecommendedCache,
	parseSourceKey,
	sourcesMatch,
	npmNameMatchesPath,
} from "../routes/recommended-routes.js";

function makeWrapper(installed: {
	global?: Array<{ source: string; installedPath?: string }>;
	local?: Array<{ source: string; installedPath?: string }>;
}): any {
	return {
		listInstalled: vi.fn(async (scope: string) =>
			scope === "global" ? installed.global ?? [] : installed.local ?? [],
		),
	};
}

describe("parseSourceKey", () => {
	it("parses npm: sources", () => {
		expect(parseSourceKey("npm:pi-web-access")).toEqual({
			kind: "npm",
			name: "pi-web-access",
		});
	});

	it("parses scoped npm: sources", () => {
		expect(parseSourceKey("npm:@scope/example-pkg")).toEqual({
			kind: "npm",
			name: "@scope/example-pkg",
		});
	});

	it("strips version from npm: sources", () => {
		expect(parseSourceKey("npm:pi-web-access@1.2.3")).toEqual({
			kind: "npm",
			name: "pi-web-access",
		});
		expect(parseSourceKey("npm:@scope/pkg@1.0.0")).toEqual({
			kind: "npm",
			name: "@scope/pkg",
		});
	});

	it("parses git@ SSH URLs", () => {
		expect(parseSourceKey("git@github.com:BlackBeltTechnology/pi-flows.git")).toEqual({
			kind: "git",
			host: "github.com",
			owner: "BlackBeltTechnology",
			repo: "pi-flows",
		});
	});

	it("parses https git URLs", () => {
		expect(
			parseSourceKey("https://github.com/BlackBeltTechnology/pi-flows.git"),
		).toEqual({
			kind: "git",
			host: "github.com",
			owner: "BlackBeltTechnology",
			repo: "pi-flows",
		});
	});

	it("falls back to raw for unknown forms", () => {
		expect(parseSourceKey("/local/path")).toEqual({
			kind: "raw",
			source: "/local/path",
		});
	});
});

describe("sourcesMatch", () => {
	it("matches npm sources with and without version", () => {
		expect(sourcesMatch("npm:pi-web-access", "npm:pi-web-access@1.0.0")).toBe(true);
	});

	it("matches git SSH and HTTPS forms of the same repo", () => {
		expect(
			sourcesMatch(
				"git@github.com:BlackBeltTechnology/pi-flows.git",
				"https://github.com/BlackBeltTechnology/pi-flows.git",
			),
		).toBe(true);
	});

	it("is case-insensitive on the git host/owner/repo", () => {
		expect(
			sourcesMatch(
				"git@github.com:BlackBeltTechnology/pi-flows.git",
				"git@github.com:blackbelttechnology/pi-flows.git",
			),
		).toBe(true);
	});

	it("distinguishes different repos", () => {
		expect(
			sourcesMatch(
				"git@github.com:BlackBeltTechnology/pi-flows.git",
				"git@github.com:BlackBeltTechnology/pi-anthropic-messages.git",
			),
		).toBe(false);
	});

	it("matches a git URL against a local path whose basename equals the repo name", () => {
		expect(
			sourcesMatch(
				"git@github.com:BlackBeltTechnology/pi-flows.git",
				"../pi-flows",
			),
		).toBe(true);
		expect(
			sourcesMatch(
				"../pi-anthropic-messages",
				"git@github.com:BlackBeltTechnology/pi-anthropic-messages.git",
			),
		).toBe(true);
		expect(
			sourcesMatch(
				"git@github.com:BlackBeltTechnology/pi-flows.git",
				"/home/user/src/pi-flows/",
			),
		).toBe(true);
	});

	it("does not cross-match a git URL against an unrelated local path", () => {
		expect(
			sourcesMatch(
				"git@github.com:BlackBeltTechnology/pi-flows.git",
				"../pi-web-access",
			),
		).toBe(false);
	});
});

describe("npmNameMatchesPath (pure name predicate)", () => {
	it("E5: matches an npm entry when the on-disk name equals the scoped npm name", () => {
		const readPkg = () => ({ name: "@blackbelt-technology/pi-anti-slop" });
		expect(
			npmNameMatchesPath("npm:@blackbelt-technology/pi-anti-slop", "/checkouts/anti-slop", readPkg),
		).toBe(true);
	});

	it("E5: exact compare — unscoped name does not match a scoped entry", () => {
		const readPkg = () => ({ name: "pi-anti-slop" }); // missing @scope/ prefix
		expect(
			npmNameMatchesPath("npm:@blackbelt-technology/pi-anti-slop", "/x", readPkg),
		).toBe(false);
	});

	it("E4: non-npm (git) entry never name-matches, regardless of on-disk name", () => {
		const readPkg = () => ({ name: "anything" });
		expect(
			npmNameMatchesPath("git:github.com/owner/repo", "/checkouts/repo", readPkg),
		).toBe(false);
	});

	it("X4: missing candidate path → false (no read attempted)", () => {
		const readPkg = vi.fn(() => ({ name: "npm-name" }));
		expect(npmNameMatchesPath("npm:npm-name", undefined, readPkg)).toBe(false);
		expect(readPkg).not.toHaveBeenCalled();
	});

	it("X3: non-string name → false", () => {
		const readPkg = () => ({ name: 42 });
		expect(npmNameMatchesPath("npm:pi-web-access", "/x", readPkg)).toBe(false);
	});

	it("X2/X1: unreadable or invalid package.json (readPkg undefined) → false", () => {
		const readPkg = () => undefined;
		expect(npmNameMatchesPath("npm:pi-web-access", "/x", readPkg)).toBe(false);
	});
});

describe("GET /api/packages/recommended", () => {
	let fastify: FastifyInstance;
	let tmpHome: string;
	let origCwd: string;

	beforeEach(() => {
		invalidateRecommendedCache();
		vi.mocked(fetchPackageMeta).mockReset();
		vi.mocked(fetchGithubPackageJson).mockReset();

		tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-rec-"));
		process.env.HOME = tmpHome;

		// chdir to a clean subdirectory so the route's CWD-based local
		// settings read doesn't pick up the host repo's .pi/settings.json.
		origCwd = process.cwd();
		const scratchCwd = path.join(tmpHome, "scratch");
		fs.mkdirSync(scratchCwd, { recursive: true });
		process.chdir(scratchCwd);
	});

	afterEach(async () => {
		if (fastify) await fastify.close();
		process.chdir(origCwd);
		if (fs.existsSync(tmpHome)) fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	async function setupRoute(installed: {
		global?: Array<{ source: string; installedPath?: string }>;
		local?: Array<{ source: string; installedPath?: string }>;
	} = {}): Promise<FastifyInstance> {
		fastify = Fastify();
		const wrapper = makeWrapper(installed);
		registerRecommendedRoutes(fastify, { packageManagerWrapper: wrapper });
		await fastify.ready();
		return fastify;
	}

	/** Create a local checkout dir with the given basename. When `name` is a
	 * string, write a package.json carrying it (plus any extra fields); when
	 * `name` is null, write no package.json (dir exists, empty). */
	function mkLocalCheckout(
		basename: string,
		name: string | null,
		extra: Record<string, unknown> = {},
	): string {
		const dir = path.join(tmpHome, "checkouts", basename);
		fs.mkdirSync(dir, { recursive: true });
		if (name !== null) {
			fs.writeFileSync(
				path.join(dir, "package.json"),
				JSON.stringify({ name, ...extra }),
			);
		}
		return dir;
	}

	/** Write global settings.json packages[] under the tmp HOME. */
	function writeActiveSources(pkgs: string[]): void {
		const settingsDir = path.join(tmpHome, ".pi", "agent");
		fs.mkdirSync(settingsDir, { recursive: true });
		fs.writeFileSync(
			path.join(settingsDir, "settings.json"),
			JSON.stringify({ packages: pkgs }),
		);
	}

	it("surfaces a requirements probe for entries that declare `requires`", async () => {
		vi.mocked(fetchPackageMeta).mockResolvedValue(null);
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);
		await setupRoute();

		const res = await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		const body = JSON.parse(res.payload);
		const browser = body.data.recommended.find((e: any) => e.id === "pi-agent-browser");
		expect(browser.requirements).toBeDefined();
		expect(browser.requirements.binaries.map((b: any) => b.name)).toContain("agent-browser");
		// missingRequirements is always an array when requirements is present.
		expect(Array.isArray(browser.missingRequirements)).toBe(true);

		// Entries without `requires` carry no probe.
		const pwa = body.data.recommended.find((e: any) => e.id === "pi-web-access");
		expect(pwa.requirements).toBeUndefined();
	});

	it("returns the manifest entries with default (offline) descriptions", async () => {
		vi.mocked(fetchPackageMeta).mockResolvedValue(null);
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);
		await setupRoute();

		const res = await fastify.inject({
			method: "GET",
			url: "/api/packages/recommended",
		});
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.payload);
		expect(body.success).toBe(true);
		const entries = body.data.recommended;
		// The route maps the manifest unfiltered, so it must return every entry.
		expect(entries).toHaveLength(RECOMMENDED_EXTENSIONS.length);
		// Every entry falls back to fallbackDescription and has no version.
		for (const e of entries) {
			expect(typeof e.description).toBe("string");
			expect(e.description.length).toBeGreaterThan(10);
			expect(e.version).toBeUndefined();
			expect(e.installed.scope).toBeNull();
			expect(e.activeInPi).toBe(false);
			expect(e.updateAvailable).toBe(false);
		}
	});

	it("uses npm metadata when registry is reachable", async () => {
		vi.mocked(fetchPackageMeta).mockImplementation(async (name: string) => {
			if (name === "pi-web-access") {
				return { description: "LIVE npm desc", version: "9.9.9" };
			}
			return null;
		});
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);
		await setupRoute();

		const res = await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		const body = JSON.parse(res.payload);
		const pwa = body.data.recommended.find((e: any) => e.id === "pi-web-access");
		expect(pwa.description).toBe("LIVE npm desc");
		expect(pwa.version).toBe("9.9.9");
	});

	it("derives skillsRegistered from the package's pi.skills (registry meta)", async () => {
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);
		vi.mocked(fetchPackageMeta).mockImplementation(async (name: string) => {
			if (name === "@blackbelt-technology/frontend-mockup-loop") {
				return { description: "d", version: "0.5.4", skills: ["frontend-mockup-loop"] };
			}
			return null;
		});
		await setupRoute();

		const res = await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		const body = JSON.parse(res.payload);
		const mockup = body.data.recommended.find(
			(e: any) => e.id === "@blackbelt-technology/frontend-mockup-loop",
		);
		expect(mockup.skillsRegistered).toEqual(["frontend-mockup-loop"]);
		// Entries whose package ships no skills omit the field.
		const pwa = body.data.recommended.find((e: any) => e.id === "pi-web-access");
		expect(pwa.skillsRegistered).toBeUndefined();
	});

	it("enriches the now-npm-sourced pi-flows entry from npm metadata", async () => {
		// pi-flows migrated from a git source to npm:@blackbelt-technology/pi-flows,
		// so it enriches via the npm registry path, not GitHub. No recommended
		// entry is git-sourced anymore.
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);
		vi.mocked(fetchPackageMeta).mockImplementation(async (name: string) => {
			if (name === "@blackbelt-technology/pi-flows") {
				return { description: "LIVE npm desc", version: "0.2.4" };
			}
			return null;
		});
		await setupRoute();

		const res = await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		const body = JSON.parse(res.payload);
		const flows = body.data.recommended.find((e: any) => e.id === "pi-flows");
		expect(flows.description).toBe("LIVE npm desc");
		expect(flows.version).toBe("0.2.4");
	});

	it("reports installed + activeInPi correctly when settings.json lists the source", async () => {
		vi.mocked(fetchPackageMeta).mockResolvedValue(null);
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);

		// Write settings.json with pi-web-access as an active package
		const settingsDir = path.join(tmpHome, ".pi", "agent");
		fs.mkdirSync(settingsDir, { recursive: true });
		fs.writeFileSync(
			path.join(settingsDir, "settings.json"),
			JSON.stringify({ packages: ["npm:pi-web-access"] }),
		);

		await setupRoute({
			global: [{ source: "npm:pi-web-access", installedPath: "/fake" }],
		});

		const res = await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		const body = JSON.parse(res.payload);
		const pwa = body.data.recommended.find((e: any) => e.id === "pi-web-access");
		expect(pwa.installed.scope).toBe("global");
		expect(pwa.activeInPi).toBe(true);

		// Entries not in settings.json remain inactive
		const browser = body.data.recommended.find((e: any) => e.id === "pi-agent-browser");
		expect(browser.installed.scope).toBeNull();
		expect(browser.activeInPi).toBe(false);
	});

	it("matches git SSH source against git HTTPS active source", async () => {
		vi.mocked(fetchPackageMeta).mockResolvedValue(null);
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);

		const settingsDir = path.join(tmpHome, ".pi", "agent");
		fs.mkdirSync(settingsDir, { recursive: true });
		// User wrote HTTPS in settings; manifest has SSH. They should match.
		fs.writeFileSync(
			path.join(settingsDir, "settings.json"),
			JSON.stringify({
				packages: ["https://github.com/BlackBeltTechnology/pi-flows.git"],
			}),
		);

		await setupRoute();
		const res = await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		const body = JSON.parse(res.payload);
		const flows = body.data.recommended.find((e: any) => e.id === "pi-flows");
		expect(flows.activeInPi).toBe(true);
	});

	it("matches git manifest source against a local-path active source (basename heuristic)", async () => {
		vi.mocked(fetchPackageMeta).mockResolvedValue(null);
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);

		// User has pi-flows checked out locally and registered via `pi install -l`
		// which records the local path in .pi/settings.json. The manifest has the
		// git SSH URL. The two should still match via basename.
		const projectDir = path.join(tmpHome, "workspace");
		fs.mkdirSync(path.join(projectDir, ".pi"), { recursive: true });
		fs.writeFileSync(
			path.join(projectDir, ".pi", "settings.json"),
			JSON.stringify({ packages: ["../pi-flows", "../pi-anthropic-messages"] }),
		);

		const origCwd = process.cwd();
		process.chdir(projectDir);
		try {
			await setupRoute();
			const res = await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
			const body = JSON.parse(res.payload);
			const flows = body.data.recommended.find((e: any) => e.id === "pi-flows");
			const msg = body.data.recommended.find(
				(e: any) => e.id === "pi-anthropic-messages",
			);
			expect(flows.activeInPi).toBe(true);
			expect(msg.activeInPi).toBe(true);
		} finally {
			process.chdir(origCwd);
		}
	});

	it("considers project-local .pi/settings.json for activeInPi", async () => {
		vi.mocked(fetchPackageMeta).mockResolvedValue(null);
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);

		const projectDir = path.join(tmpHome, "workspace");
		fs.mkdirSync(path.join(projectDir, ".pi"), { recursive: true });
		fs.writeFileSync(
			path.join(projectDir, ".pi", "settings.json"),
			JSON.stringify({ packages: ["npm:pi-web-access"] }),
		);

		const origCwd = process.cwd();
		process.chdir(projectDir);
		try {
			await setupRoute();
			const res = await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
			const body = JSON.parse(res.payload);
			const pwa = body.data.recommended.find((e: any) => e.id === "pi-web-access");
			expect(pwa.activeInPi).toBe(true);
		} finally {
			process.chdir(origCwd);
		}
	});

	it("serves cached data on the second call within 60s", async () => {
		vi.mocked(fetchPackageMeta).mockResolvedValue({
			description: "cached",
			version: "1.0.0",
		});
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);
		await setupRoute();

		await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		const callsAfterFirst = vi.mocked(fetchPackageMeta).mock.calls.length;
		await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		expect(vi.mocked(fetchPackageMeta).mock.calls.length).toBe(callsAfterFirst);
	});

	it("refetches after invalidateRecommendedCache()", async () => {
		vi.mocked(fetchPackageMeta).mockResolvedValue({
			description: "refresh",
			version: "1.0.0",
		});
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);
		await setupRoute();

		await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		const before = vi.mocked(fetchPackageMeta).mock.calls.length;
		invalidateRecommendedCache();
		await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		expect(vi.mocked(fetchPackageMeta).mock.calls.length).toBeGreaterThan(before);
	});

	// --- fs-aware local-install name resolution (match-local-installs-by-package-name) ---

	const IMG_ENTRY = "@blackbelt-technology/pi-image-fit-extension";
	const IMG_SRC = "npm:@blackbelt-technology/pi-image-fit-extension";

	it("E1: decorated local checkout matches by package.json name (installed + active)", async () => {
		vi.mocked(fetchPackageMeta).mockResolvedValue(null);
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);
		// basename `image-fit-extension` != unscoped npm name `pi-image-fit-extension`
		// so sourcesMatch fails; only the package.json name resolves the match.
		const dir = mkLocalCheckout("image-fit-extension", IMG_ENTRY);
		writeActiveSources([dir]);
		await setupRoute({ global: [{ source: dir, installedPath: dir }] });

		const res = await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		const body = JSON.parse(res.payload);
		const img = body.data.recommended.find((e: any) => e.id === IMG_ENTRY);
		expect(sourcesMatch(dir, IMG_SRC)).toBe(false); // proves the string path fails
		expect(img.installed.scope).toBe("global");
		expect(img.activeInPi).toBe(true);
		// shape unchanged: same keys as any other entry
		expect(img).toHaveProperty("installed.scope");
		expect(img).toHaveProperty("updateAvailable");
	});

	it("E2: unrelated local package (different name, non-matching basename) not installed", async () => {
		vi.mocked(fetchPackageMeta).mockResolvedValue(null);
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);
		const dir = mkLocalCheckout("some-other-pkg", "@acme/unrelated");
		await setupRoute({ global: [{ source: dir, installedPath: dir }] });

		const res = await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		const body = JSON.parse(res.payload);
		const img = body.data.recommended.find((e: any) => e.id === IMG_ENTRY);
		expect(img.installed.scope).toBeNull();
		expect(img.activeInPi).toBe(false);
	});

	it("E3: name mismatch never breaks a valid string (basename) match", async () => {
		vi.mocked(fetchPackageMeta).mockResolvedValue(null);
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);
		// basename `pi-web-access` string-matches npm:pi-web-access, but the
		// on-disk name is wrong — either-match must still count it installed.
		const dir = mkLocalCheckout("pi-web-access", "totally-different-name");
		await setupRoute({ global: [{ source: dir, installedPath: dir }] });

		const res = await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		const body = JSON.parse(res.payload);
		const pwa = body.data.recommended.find((e: any) => e.id === "pi-web-access");
		expect(sourcesMatch(dir, "npm:pi-web-access")).toBe(true);
		expect(pwa.installed.scope).toBe("global");
	});

	it("X1: package.json absent → falls back to string match (no throw)", async () => {
		vi.mocked(fetchPackageMeta).mockResolvedValue(null);
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);
		// basename string-matches; dir has NO package.json.
		const dir = mkLocalCheckout("pi-web-access", null);
		await setupRoute({ global: [{ source: dir, installedPath: dir }] });

		const res = await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.payload);
		const pwa = body.data.recommended.find((e: any) => e.id === "pi-web-access");
		expect(pwa.installed.scope).toBe("global"); // string fallback still matches
	});

	it("X2: invalid package.json JSON → name path false, no throw", async () => {
		vi.mocked(fetchPackageMeta).mockResolvedValue(null);
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);
		const dir = path.join(tmpHome, "checkouts", "image-fit-extension");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "package.json"), "{invalid json");
		await setupRoute({ global: [{ source: dir, installedPath: dir }] });

		const res = await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.payload);
		const img = body.data.recommended.find((e: any) => e.id === IMG_ENTRY);
		expect(img.installed.scope).toBeNull(); // no string match, name path failed closed
	});

	it("F1: activeInPi flips true via activeSources name match (no installed row)", async () => {
		vi.mocked(fetchPackageMeta).mockResolvedValue(null);
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);
		// The bug-fixing site: entry present ONLY in settings packages[], not in
		// any installed row. activeInPi must resolve by reading the path's name.
		const dir = mkLocalCheckout("image-fit-extension", IMG_ENTRY);
		writeActiveSources([dir]);
		await setupRoute(); // no installed rows

		const res = await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		const body = JSON.parse(res.payload);
		const img = body.data.recommended.find((e: any) => e.id === IMG_ENTRY);
		expect(img.activeInPi).toBe(true);
		expect(img.installed.scope).toBeNull(); // not in installed lists — activeInPi is the site under test
	});

	it("F2: newly name-matched entry still gets version/skills read (inner .find fires)", async () => {
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);
		vi.mocked(fetchPackageMeta).mockImplementation(async (name: string) =>
			name === IMG_ENTRY ? { description: "d", version: "2.0.0" } : null,
		);
		// name-matches (decorated basename) but does NOT string-match; carries
		// version + pi.skills on disk.
		const dir = mkLocalCheckout("image-fit-extension", IMG_ENTRY, {
			version: "1.0.0",
			pi: { skills: ["image-fit"] },
		});
		await setupRoute({ global: [{ source: dir, installedPath: dir }] });

		const res = await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		const body = JSON.parse(res.payload);
		const img = body.data.recommended.find((e: any) => e.id === IMG_ENTRY);
		expect(img.skillsRegistered).toEqual(["image-fit"]); // read was NOT skipped
		expect(img.updateAvailable).toBe(true); // 1.0.0 (disk) vs 2.0.0 (registry)
	});

	it("P1: package.json name reads are memoized per path within a request", async () => {
		vi.mocked(fetchPackageMeta).mockResolvedValue(null);
		vi.mocked(fetchGithubPackageJson).mockResolvedValue(null);
		const dir = mkLocalCheckout("image-fit-extension", IMG_ENTRY);
		// same path appears in BOTH an installed row and activeSources; across all
		// ~18 recommended entries the failed-string-match path would re-read it
		// many times without the memo.
		writeActiveSources([dir]);
		const readSpy = vi.spyOn(fs, "readFileSync");
		await setupRoute({ global: [{ source: dir, installedPath: dir }] });
		readSpy.mockClear();

		await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
		const readsOfThisPkg = readSpy.mock.calls.filter(
			([p]) => typeof p === "string" && p === path.join(dir, "package.json"),
		).length;
		readSpy.mockRestore();
		// memoized: the one distinct path is read at most once per request.
		expect(readsOfThisPkg).toBeLessThanOrEqual(1);
	});
});

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
vi.mock("../package/npm-search-proxy.js", () => ({
	fetchPackageMeta: vi.fn(),
	fetchGithubPackageJson: vi.fn(),
}));

import { fetchPackageMeta, fetchGithubPackageJson } from "../package/npm-search-proxy.js";
import {
	registerRecommendedRoutes,
	invalidateRecommendedCache,
	parseSourceKey,
	sourcesMatch,
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
		expect(entries).toHaveLength(18);
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
});

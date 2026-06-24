import { describe, it, expect } from "vitest";
import {
	BUNDLED_EXTENSION_IDS,
	RECOMMENDED_EXTENSIONS,
	getRecommendedExtension,
	getRecommendedByStatus,
	type RecommendedExtension,
} from "../recommended-extensions.js";

describe("RECOMMENDED_EXTENSIONS manifest", () => {
	it("contains exactly the seven expected entries", () => {
		const ids = RECOMMENDED_EXTENSIONS.map((e) => e.id).sort();
		expect(ids).toEqual(
			[
				"pi-anthropic-messages",
				"pi-agent-browser",
				"@blackbelt-technology/pi-dashboard-subagents",
				"@blackbelt-technology/pi-image-fit-extension",
				"pi-flows",
				"pi-memory-honcho",
				"pi-web-access",
			].sort(),
		);
	});

	it("every entry has the required shape", () => {
		for (const entry of RECOMMENDED_EXTENSIONS) {
			expect(typeof entry.id).toBe("string");
			expect(entry.id.length).toBeGreaterThan(0);
			expect(typeof entry.source).toBe("string");
			expect(entry.source.length).toBeGreaterThan(0);
			expect(typeof entry.displayName).toBe("string");
			expect(typeof entry.fallbackDescription).toBe("string");
			expect(entry.fallbackDescription.length).toBeGreaterThan(10);
			expect(["required", "strongly-suggested", "optional"]).toContain(entry.status);
			expect(Array.isArray(entry.unlocks)).toBe(true);
			expect(entry.unlocks.length).toBeGreaterThan(0);
			// dashboardPlugin is optional; when present, must be a non-empty string.
			// See change: add-plugin-activation-ui.
			if (entry.dashboardPlugin !== undefined) {
				expect(typeof entry.dashboardPlugin).toBe("string");
				expect(entry.dashboardPlugin.length).toBeGreaterThan(0);
			}
		}
	});

	it("pi-memory-honcho declares its companion dashboard plugin id", () => {
		// See change: add-plugin-activation-ui (Layer 1.5).
		const entry = getRecommendedExtension("pi-memory-honcho");
		expect(entry?.dashboardPlugin).toBe("honcho");
	});

	it("pi-anthropic-messages is marked required and uses the npm: source", () => {
		// Republished to the @blackbelt-technology npm scope; the source MUST be
		// the npm spec so sourcesMatch recognizes the npm install. See change:
		// suppress-hidden-session-auto-navigation (develop regression follow-up).
		const entry = getRecommendedExtension("pi-anthropic-messages");
		expect(entry).toBeDefined();
		expect(entry?.status).toBe("required");
		expect(entry?.source).toBe("npm:@blackbelt-technology/pi-anthropic-messages");
		expect(entry?.autowired).toBe(true);
	});

	it("pi-flows uses HTTPS git URL and registers flow-engine tools", () => {
		const entry = getRecommendedExtension("pi-flows");
		expect(entry).toBeDefined();
		expect(entry?.source).toBe("https://github.com/BlackBeltTechnology/pi-flows.git");
		expect(entry?.toolsRegistered).toContain("subagent");
		expect(entry?.toolsRegistered).toContain("flow_write");
	});

	it("pi-dashboard-subagents registers Agent and pairs with the subagents plugin", () => {
		// See change: add-subagent-inspector.
		const entry = getRecommendedExtension("@blackbelt-technology/pi-dashboard-subagents");
		expect(entry).toBeDefined();
		expect(entry?.source).toBe(
			"npm:@blackbelt-technology/pi-dashboard-subagents",
		);
		expect(entry?.toolsRegistered).toEqual(["Agent"]);
		expect(entry?.dashboardPlugin).toBe("subagents");
		expect(entry?.autowired).toBe(true);
	});

	it("npm-sourced entries use the npm: prefix", () => {
		const npmEntries = RECOMMENDED_EXTENSIONS.filter((e) => e.source.startsWith("npm:"));
		expect(npmEntries.map((e) => e.id).sort()).toEqual(
			[
				"pi-anthropic-messages",
				"pi-agent-browser",
				"pi-memory-honcho",
				"pi-web-access",
				"@blackbelt-technology/pi-dashboard-subagents",
				"@blackbelt-technology/pi-image-fit-extension",
			].sort(),
		);
	});

	it("git-sourced entries use the https://github.com/.../.git HTTPS form", () => {
		const gitEntries = RECOMMENDED_EXTENSIONS.filter((e) =>
			e.source.startsWith("https://github.com/"),
		);
		for (const entry of gitEntries) {
			expect(entry.source).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\.git$/);
		}
		expect(gitEntries.map((e) => e.id).sort()).toEqual(
			["pi-flows"].sort(),
		);
	});
});

describe("getRecommendedExtension", () => {
	it("returns the entry when id matches", () => {
		const e = getRecommendedExtension("pi-web-access");
		expect(e?.displayName).toBe("pi-web-access");
	});

	it("returns undefined for unknown ids", () => {
		expect(getRecommendedExtension("does-not-exist")).toBeUndefined();
	});
});

describe("getRecommendedByStatus", () => {
	it("filters by required", () => {
		const required = getRecommendedByStatus("required");
		expect(required.map((e) => e.id)).toEqual(["pi-anthropic-messages"]);
	});

	it("filters by strongly-suggested", () => {
		const suggested = getRecommendedByStatus("strongly-suggested");
		expect(suggested.map((e) => e.id).sort()).toEqual(
			["pi-flows", "pi-web-access"].sort(),
		);
	});

	it("filters by optional", () => {
		const optional = getRecommendedByStatus("optional");
		expect(optional.map((e) => e.id).sort()).toEqual(
			[
				"pi-agent-browser",
				"@blackbelt-technology/pi-dashboard-subagents",
				"@blackbelt-technology/pi-image-fit-extension",
				"pi-memory-honcho",
			].sort(),
		);
	});
});

describe("RecommendedExtension type", () => {
	it("accepts a minimal entry", () => {
		const entry: RecommendedExtension = {
			id: "x",
			source: "npm:x",
			displayName: "X",
			fallbackDescription: "A test extension description.",
			status: "optional",
			unlocks: ["something"],
		};
		expect(entry.id).toBe("x");
	});
});

// ── BUNDLED_EXTENSION_IDS manifest (task 2 of bundle-first-party-extensions) ──

describe("BUNDLED_EXTENSION_IDS manifest", () => {
	it("contains exactly the v0.x initial bundled set", () => {
		// Empty: every previously-bundled extension has migrated to an npm:
		// source and now installs via the recommended-extensions UI, not the
		// pre-bundle path (which only handles git sources).
		// - pi-anthropic-messages: npm rescope. See change:
		//   suppress-hidden-session-auto-navigation (develop regression follow-up).
		// - @blackbelt-technology/pi-dashboard-subagents: npm: source in v0.2.0.
		// - pi-flows: not bundled until upstream declares an SPDX license.
		expect([...BUNDLED_EXTENSION_IDS]).toEqual([]);
	});

	it("every bundled id appears in RECOMMENDED_EXTENSIONS", () => {
		const recommendedIds = new Set(RECOMMENDED_EXTENSIONS.map((e) => e.id));
		for (const id of BUNDLED_EXTENSION_IDS) {
			expect(recommendedIds.has(id)).toBe(true);
		}
	});

	it("every bundled id has a git-based source (no npm:, no local paths)", () => {
		for (const id of BUNDLED_EXTENSION_IDS) {
			const entry = RECOMMENDED_EXTENSIONS.find((e) => e.id === id);
			expect(entry, `RECOMMENDED_EXTENSIONS missing entry for ${id}`).toBeDefined();
			const source = entry!.source;
			const isGit =
				source.endsWith(".git") ||
				source.startsWith("git@") ||
				source.startsWith("git:") ||
				/^https?:\/\/.+\/.+/.test(source);
			expect(isGit, `${id} source is not git-based: ${source}`).toBe(true);
			expect(source.startsWith("npm:"), `${id} must not be an npm source`).toBe(false);
		}
	});
});

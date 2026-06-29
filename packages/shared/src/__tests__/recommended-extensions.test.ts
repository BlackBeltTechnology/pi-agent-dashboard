import { describe, it, expect } from "vitest";
import {
	BUNDLED_EXTENSION_IDS,
	RECOMMENDED_EXTENSIONS,
	getRecommendedExtension,
	getRecommendedByStatus,
	type RecommendedExtension,
} from "../recommended-extensions.js";

describe("RECOMMENDED_EXTENSIONS manifest", () => {
	it("contains exactly the eighteen expected entries", () => {
		const ids = RECOMMENDED_EXTENSIONS.map((e) => e.id).sort();
		expect(ids).toEqual(
			[
				"pi-anthropic-messages",
				"pi-agent-browser",
				"@blackbelt-technology/pi-dashboard-subagents",
				"@blackbelt-technology/pi-image-fit-extension",
				"@blackbelt-technology/pi-model-proxy",
				"@ricoyudog/pi-goal-hermes",
				"context-mode",
				"pi-flows",
				"pi-hermes-memory",
				"pi-simplify",
				"pi-web-access",
				"@blackbelt-technology/pi-dashboard-kb-extension",
				"@blackbelt-technology/frontend-mockup-loop",
				"@blackbelt-technology/pi-dashboard-plugin-skill",
				"@blackbelt-technology/pi-dashboard-document-converter",
				"@blackbelt-technology/anti-slop-frontend",
				"@blackbelt-technology/pi-dashboard-eng-disciplines",
				"@blackbelt-technology/pi-dashboard-authoring-toolkit",
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

	it("pi-flows uses the npm source and registers flow-engine tools", () => {
		// Switched from the git URL to the published npm package so
		// sourcesMatch recognizes the npm install. Still NOT bundled
		// (absent from BUNDLED_EXTENSION_IDS) until upstream declares a license.
		const entry = getRecommendedExtension("pi-flows");
		expect(entry).toBeDefined();
		expect(entry?.source).toBe("npm:@blackbelt-technology/pi-flows");
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

	it("every entry uses the npm: prefix (all recommended entries are now npm-sourced)", () => {
		const npmEntries = RECOMMENDED_EXTENSIONS.filter((e) => e.source.startsWith("npm:"));
		expect(npmEntries.map((e) => e.id).sort()).toEqual(
			RECOMMENDED_EXTENSIONS.map((e) => e.id).sort(),
		);
	});

	it("has no git-sourced entries", () => {
		// pi-flows moved to its npm source; no recommended entry is git-based.
		const gitEntries = RECOMMENDED_EXTENSIONS.filter(
			(e) => !e.source.startsWith("npm:"),
		);
		expect(gitEntries).toEqual([]);
	});

	it("pi-agent-browser declares its agent-browser binary requirement", () => {
		const entry = getRecommendedExtension("pi-agent-browser");
		expect(entry?.requires?.binaries).toContain("agent-browser");
	});

	it("requires, when present, only names binaries/services/piExtensions that are probeable", () => {
		// Guard against shipping always-red requirements: a declared `services`
		// entry must be a known service probe (V1 closed registry: pi-model-proxy).
		const KNOWN_SERVICES = new Set(["pi-model-proxy"]);
		for (const e of RECOMMENDED_EXTENSIONS) {
			if (!e.requires) continue;
			for (const svc of e.requires.services ?? []) {
				expect(KNOWN_SERVICES.has(svc)).toBe(true);
			}
		}
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
			[
				"pi-flows",
				"pi-web-access",
				"context-mode",
				"@blackbelt-technology/pi-dashboard-kb-extension",
			].sort(),
		);
	});

	it("filters by optional", () => {
		const optional = getRecommendedByStatus("optional");
		expect(optional.map((e) => e.id).sort()).toEqual(
			[
				"pi-agent-browser",
				"@blackbelt-technology/pi-dashboard-subagents",
				"@blackbelt-technology/pi-image-fit-extension",
				"@blackbelt-technology/pi-model-proxy",
				"@ricoyudog/pi-goal-hermes",
				"pi-hermes-memory",
				"pi-simplify",
				"@blackbelt-technology/frontend-mockup-loop",
				"@blackbelt-technology/pi-dashboard-plugin-skill",
				"@blackbelt-technology/pi-dashboard-document-converter",
				"@blackbelt-technology/anti-slop-frontend",
				"@blackbelt-technology/pi-dashboard-eng-disciplines",
				"@blackbelt-technology/pi-dashboard-authoring-toolkit",
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

import { describe, it, expect } from "vitest";
import {
	BUNDLED_EXTENSION_IDS,
	RECOMMENDED_EXTENSIONS,
	getRecommendedExtension,
	getRecommendedByStatus,
	type RecommendedExtension,
} from "../recommended-extensions.js";

describe("RECOMMENDED_EXTENSIONS manifest", () => {
	it("contains exactly the five expected entries", () => {
		const ids = RECOMMENDED_EXTENSIONS.map((e) => e.id).sort();
		expect(ids).toEqual(
			[
				"pi-anthropic-messages",
				"pi-agent-browser",
				"pi-flows",
				"pi-web-access",
				"tintinweb-pi-subagents",
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
		}
	});

	it("pi-anthropic-messages is marked required and uses HTTPS git URL", () => {
		const entry = getRecommendedExtension("pi-anthropic-messages");
		expect(entry).toBeDefined();
		expect(entry?.status).toBe("required");
		expect(entry?.source).toContain("https://github.com/BlackBeltTechnology/pi-anthropic-messages.git");
		expect(entry?.autowired).toBe(true);
	});

	it("pi-flows uses HTTPS git URL and registers flow-engine tools", () => {
		const entry = getRecommendedExtension("pi-flows");
		expect(entry).toBeDefined();
		expect(entry?.source).toBe("https://github.com/BlackBeltTechnology/pi-flows.git");
		expect(entry?.toolsRegistered).toContain("subagent");
		expect(entry?.toolsRegistered).toContain("flow_write");
	});

	it("tintinweb-pi-subagents registers Agent under its canonical capitalization", () => {
		const entry = getRecommendedExtension("tintinweb-pi-subagents");
		expect(entry).toBeDefined();
		expect(entry?.source).toBe("npm:@tintinweb/pi-subagents");
		expect(entry?.toolsRegistered).toContain("Agent");
	});

	it("npm-sourced entries use the npm: prefix", () => {
		const npmEntries = RECOMMENDED_EXTENSIONS.filter((e) => e.source.startsWith("npm:"));
		expect(npmEntries.map((e) => e.id).sort()).toEqual(
			["pi-agent-browser", "pi-web-access", "tintinweb-pi-subagents"].sort(),
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
			["pi-anthropic-messages", "pi-flows"].sort(),
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
			["pi-flows", "pi-web-access", "tintinweb-pi-subagents"].sort(),
		);
	});

	it("filters by optional", () => {
		const optional = getRecommendedByStatus("optional");
		expect(optional.map((e) => e.id)).toEqual(["pi-agent-browser"]);
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
		// pi-flows temporarily removed: upstream repo lacks SPDX license,
		// blocking the bundle-recommended-extensions.mjs license check.
		// Re-add when https://github.com/BlackBeltTechnology/pi-flows has
		// a license declared.
		expect([...BUNDLED_EXTENSION_IDS].sort()).toEqual(
			["pi-anthropic-messages"].sort(),
		);
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

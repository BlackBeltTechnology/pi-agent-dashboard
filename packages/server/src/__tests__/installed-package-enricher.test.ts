/**
 * Unit tests for the installed-package enricher (used by /api/packages/installed).
 *
 * The enricher is pure-with-injected-IO: every external dep
 * (readMeta, existsFn, manifest, bundledIds) is replaceable. We
 * exercise each branch without touching the real filesystem.
 */
import { describe, it, expect } from "vitest";
import {
	enrichInstalledRow,
	extractBasenameFromSource,
	matchRecommendedEntry,
	computeIsBundled,
	type RawInstalledRow,
} from "../package/installed-package-enricher.js";
import type { RecommendedExtension } from "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js";

const FAKE_MANIFEST: readonly RecommendedExtension[] = [
	{
		id: "pi-flows",
		source: "https://github.com/BlackBeltTechnology/pi-flows.git",
		displayName: "pi-flows",
		fallbackDescription: "Flow engine for pi.",
		status: "strongly-suggested",
		unlocks: [],
		toolsRegistered: [],
	},
	{
		id: "pi-anthropic-messages",
		source: "https://github.com/BlackBeltTechnology/pi-anthropic-messages.git",
		displayName: "pi-anthropic-messages",
		fallbackDescription: "Anthropic Messages provider.",
		status: "required",
		unlocks: [],
		toolsRegistered: [],
	},
	{
		id: "@blackbelt-technology/pi-dashboard-subagents",
		source: "npm:@blackbelt-technology/pi-dashboard-subagents",
		displayName: "pi-dashboard-subagents",
		fallbackDescription: "Sub-agents for pi.",
		status: "optional",
		unlocks: [],
		toolsRegistered: [],
	},
];

describe("extractBasenameFromSource", () => {
	it("strips npm: prefix and version pin", () => {
		expect(extractBasenameFromSource("npm:pi-agent-browser")).toBe("pi-agent-browser");
		expect(extractBasenameFromSource("npm:pi-agent-browser@1.2.3")).toBe("pi-agent-browser");
		expect(extractBasenameFromSource("npm:@scope/example-pkg")).toBe("@scope/example-pkg"); // generic scoped-name parsing
	});

	it("strips .git suffix from git URLs", () => {
		expect(extractBasenameFromSource("https://github.com/BlackBeltTechnology/pi-flows.git")).toBe("pi-flows");
		expect(extractBasenameFromSource("git@github.com:BlackBeltTechnology/pi-flows.git")).toBe("pi-flows");
	});

	it("returns last path segment for local paths", () => {
		expect(extractBasenameFromSource("/home/user/pi-packages/pi-flows")).toBe("pi-flows");
		expect(extractBasenameFromSource("../../BB/pi-packages/pi-flows")).toBe("pi-flows");
	});

	it("falls back to the raw source when nothing else matches", () => {
		expect(extractBasenameFromSource("weird-thing")).toBe("weird-thing");
	});
});

describe("matchRecommendedEntry", () => {
	it("matches by exact source", () => {
		expect(
			matchRecommendedEntry("npm:@blackbelt-technology/pi-dashboard-subagents", FAKE_MANIFEST)?.id,
		).toBe("@blackbelt-technology/pi-dashboard-subagents");
	});

	it("matches git source regardless of trailing slash / case", () => {
		expect(
			matchRecommendedEntry(
				"https://github.com/BlackBeltTechnology/pi-flows.git",
				FAKE_MANIFEST,
			)?.id,
		).toBe("pi-flows");
	});

	it("returns undefined when no entry matches", () => {
		expect(matchRecommendedEntry("npm:weird-other-pkg", FAKE_MANIFEST)).toBeUndefined();
	});
});

describe("computeIsBundled", () => {
	it("returns false when no resourcesPath", () => {
		expect(computeIsBundled("pi-flows", undefined, () => true, ["pi-flows"])).toBe(false);
	});

	it("returns false when id not in bundledIds", () => {
		expect(computeIsBundled("pi-flows", "/res", () => true, ["pi-anthropic-messages"])).toBe(false);
	});

	it("returns false when bundle dir missing on disk", () => {
		expect(computeIsBundled("pi-flows", "/res", () => false, ["pi-flows"])).toBe(false);
	});

	it("returns true when all conditions met", () => {
		const exists = (p: string) => p === "/res/bundled-extensions/pi-flows";
		expect(computeIsBundled("pi-flows", "/res", exists, ["pi-flows"])).toBe(true);
	});
});

describe("enrichInstalledRow", () => {
	const baseDeps = {
		manifest: FAKE_MANIFEST,
		bundledIds: ["pi-flows", "pi-anthropic-messages"],
	};

	it("enriches a recommended npm row with displayName and description from manifest", () => {
		const row: RawInstalledRow = {
			source: "npm:@blackbelt-technology/pi-dashboard-subagents",
			scope: "user",
			filtered: false,
			installedPath: "/fake/path",
		};
		const out = enrichInstalledRow(row, {
			...baseDeps,
			readMeta: () => ({ version: "0.1.1", description: "Live npm desc" }),
			existsFn: () => false,
			resourcesPath: "/res",
		});
		expect(out.displayName).toBe("pi-dashboard-subagents");
		// Recommended manifest description wins over package.json description.
		expect(out.description).toBe("Sub-agents for pi.");
		expect(out.version).toBe("0.1.1");
		expect(out.isRecommended).toBe(true);
		expect(out.isBundled).toBe(false);
	});

	it("enriches a recommended git row that is bundled", () => {
		const row: RawInstalledRow = {
			source: "https://github.com/BlackBeltTechnology/pi-flows.git",
			scope: "user",
			filtered: false,
			installedPath: "/cache/pi-flows",
		};
		const out = enrichInstalledRow(row, {
			...baseDeps,
			readMeta: () => ({ version: "0.1.0", description: "from package.json" }),
			existsFn: (p) => p === "/res/bundled-extensions/pi-flows",
			resourcesPath: "/res",
		});
		expect(out.isRecommended).toBe(true);
		expect(out.isBundled).toBe(true);
		expect(out.displayName).toBe("pi-flows");
	});

	it("enriches a non-recommended row using basename + package.json", () => {
		const row: RawInstalledRow = {
			source: "/home/dev/pi-mystery",
			scope: "user",
			filtered: false,
			installedPath: "/home/dev/pi-mystery",
		};
		const out = enrichInstalledRow(row, {
			...baseDeps,
			readMeta: () => ({ version: "9.9.9", description: "Mystery extension" }),
			existsFn: () => false,
		});
		expect(out.isRecommended).toBe(false);
		expect(out.isBundled).toBe(false);
		expect(out.displayName).toBe("pi-mystery");
		expect(out.description).toBe("Mystery extension");
		expect(out.version).toBe("9.9.9");
	});

	it("handles missing installedPath silently", () => {
		const row: RawInstalledRow = {
			source: "npm:@blackbelt-technology/pi-dashboard-subagents",
			scope: "user",
			filtered: false,
		};
		const out = enrichInstalledRow(row, {
			...baseDeps,
			readMeta: () => ({}),
			existsFn: () => false,
		});
		expect(out.version).toBeUndefined();
		// Manifest description still applies.
		expect(out.description).toBe("Sub-agents for pi.");
		expect(out.isRecommended).toBe(true);
	});

	it("handles unreadable package.json silently", () => {
		const row: RawInstalledRow = {
			source: "/local/broken",
			scope: "user",
			filtered: false,
			installedPath: "/local/broken",
		};
		const out = enrichInstalledRow(row, {
			...baseDeps,
			readMeta: () => ({}),
			existsFn: () => false,
		});
		expect(out.version).toBeUndefined();
		expect(out.description).toBeUndefined();
		expect(out.isRecommended).toBe(false);
		expect(out.displayName).toBe("broken");
	});

	it("isBundled is always false outside Electron (no resourcesPath)", () => {
		const row: RawInstalledRow = {
			source: "https://github.com/BlackBeltTechnology/pi-flows.git",
			scope: "user",
			filtered: false,
			installedPath: "/cache/pi-flows",
		};
		const out = enrichInstalledRow(row, {
			...baseDeps,
			readMeta: () => ({ version: "0.1.0" }),
			existsFn: () => true,
			resourcesPath: undefined,
		});
		expect(out.isRecommended).toBe(true);
		expect(out.isBundled).toBe(false);
	});
});

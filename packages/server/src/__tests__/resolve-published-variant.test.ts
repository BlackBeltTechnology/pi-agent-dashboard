/**
 * Unit tests for resolvePublishedVariant — the helper that decides whether
 * a local/git installed row has a canonical published npm/git variant to
 * reset to. See change: reset-override-to-npm.
 *
 * Two resolution paths:
 *   - recommended row → RECOMMENDED_EXTENSIONS manifest source (offline).
 *   - non-recommended local row whose package.json `name` resolves on npm.
 * Purely-local rows with no published match → undefined; plain npm rows → undefined.
 */

import type { RecommendedExtension } from "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js";
import type { InstalledPackage } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { describe, expect, it } from "vitest";
import { resolvePublishedVariant } from "../package/installed-package-enricher.js";

const MANIFEST: readonly RecommendedExtension[] = [
	{
		id: "pi-web-access",
		source: "npm:pi-web-access",
		displayName: "pi-web-access",
		fallbackDescription: "Web access for pi.",
		status: "optional",
		unlocks: [],
		toolsRegistered: [],
	},
];

function row(overrides: Partial<InstalledPackage>): InstalledPackage {
	return {
		source: "/home/dev/pi-web-access",
		scope: "user",
		filtered: false,
		isRecommended: true,
		...overrides,
	};
}

describe("resolvePublishedVariant", () => {
	it("recommended local override → manifest npm source resolves even when the version lookup throws", async () => {
		// Source resolution is offline (manifest); the version lookup is
		// best-effort — a throwing/offline registry must NOT break resolution,
		// it just yields no version.
		const out = await resolvePublishedVariant(row({}), {
			manifest: MANIFEST,
			lookupNpm: async () => {
				throw new Error("registry offline");
			},
			readName: () => undefined,
		});
		expect(out?.source).toBe("npm:pi-web-access");
		expect(out?.version).toBeUndefined();
	});

	it("recommended path enriches version best-effort when the registry answers", async () => {
		const out = await resolvePublishedVariant(row({}), {
			manifest: MANIFEST,
			lookupNpm: async () => ({ version: "0.5.0" }),
			readName: () => undefined,
		});
		expect(out).toEqual({ source: "npm:pi-web-access", version: "0.5.0" });
	});

	it("non-recommended local row whose package.json name resolves on npm → npm:<name> + version", async () => {
		const out = await resolvePublishedVariant(
			row({ source: "/home/dev/acme-linter", isRecommended: false }),
			{
				manifest: MANIFEST,
				readName: () => "acme-linter",
				lookupNpm: async (name) =>
					name === "acme-linter" ? { version: "2.1.0" } : null,
			},
		);
		expect(out).toEqual({ source: "npm:acme-linter", version: "2.1.0" });
	});

	it("purely-local row with no npm match → undefined", async () => {
		const out = await resolvePublishedVariant(
			row({ source: "/home/dev/secret-thing", isRecommended: false }),
			{
				manifest: MANIFEST,
				readName: () => "secret-thing",
				lookupNpm: async () => null,
			},
		);
		expect(out).toBeUndefined();
	});

	it("non-recommended local row with no readable package.json name → undefined", async () => {
		const out = await resolvePublishedVariant(
			row({ source: "/home/dev/mystery", isRecommended: false }),
			{
				manifest: MANIFEST,
				readName: () => undefined,
				lookupNpm: async () => ({ version: "9.9.9" }),
			},
		);
		expect(out).toBeUndefined();
	});

	it("plain npm row → undefined (nothing to reset)", async () => {
		const out = await resolvePublishedVariant(
			row({ source: "npm:pi-web-access", isRecommended: true }),
			{
				manifest: MANIFEST,
				readName: () => undefined,
				lookupNpm: async () => ({ version: "0.5.0" }),
			},
		);
		expect(out).toBeUndefined();
	});

	it("returns undefined when the resolved variant is identity-equal to the installed source", async () => {
		// A git-installed recommended whose manifest source is the SAME git repo
		// has no distinct published target.
		const gitManifest: readonly RecommendedExtension[] = [
			{
				id: "pi-flows",
				source: "https://github.com/Acme/pi-flows.git",
				displayName: "pi-flows",
				fallbackDescription: "",
				status: "optional",
				unlocks: [],
				toolsRegistered: [],
			},
		];
		const out = await resolvePublishedVariant(
			row({ source: "https://github.com/Acme/pi-flows.git", isRecommended: true }),
			{ manifest: gitManifest, readName: () => undefined, lookupNpm: async () => null },
		);
		expect(out).toBeUndefined();
	});
});

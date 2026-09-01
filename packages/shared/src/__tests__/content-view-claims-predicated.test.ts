/**
 * Repo-lint: every dashboard plugin `content-view` claim MUST declare a
 * `predicate`.
 *
 * `content-view` is not additive — it REPLACES the main content area. App.tsx
 * renders it as:
 *
 *   (selectedSession && forSession(getClaims("content-view"), selectedSession).length > 0
 *     ? <ContentViewSlot ... />
 *     : null) ?? sessionDetail ?? <LandingPage />
 *
 * `forSession` keeps every claim whose predicate is absent. So a predicate-less
 * content-view claim passes the filter for EVERY session, the slot renders, and
 * it wins the `?? sessionDetail` chain — the plugin's panel silently occludes
 * the chat for all sessions, everywhere.
 *
 * This is not hypothetical: cost-estimator shipped exactly this claim and
 * hijacked every chat view. The plugin loaded fine, its own tests passed, and
 * its server route returned correct data. Nothing failed except the product.
 *
 * Route-gated slots (`command-route`, `shell-overlay-route`) are deliberately
 * NOT covered: those are gated by a `command` / `route` key, so an absent
 * predicate is correct there. `content-view` has no such key — App.tsx passes
 * it `routeParams={{}}` — leaving the predicate as its ONLY gate.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/shared/src/__tests__ → src → shared → packages. NOT four levels:
// that lands on the repo root, whose only package.json has no plugin manifest,
// silently reducing this guard to a no-op. The two "not vacuous" tests below
// exist to catch exactly that mistake.
const PACKAGES_DIR = path.resolve(__dirname, "..", "..", "..");

interface PluginClaim {
	slot?: string;
	command?: string;
	component?: string;
	predicate?: string;
}

interface ManifestSlice {
	id?: string;
	claims?: PluginClaim[];
}

function readPluginManifests(): Array<{ pkg: string; manifest: ManifestSlice }> {
	const out: Array<{ pkg: string; manifest: ManifestSlice }> = [];
	for (const entry of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const pkgJsonPath = path.join(PACKAGES_DIR, entry.name, "package.json");
		if (!fs.existsSync(pkgJsonPath)) continue;
		let parsed: { "pi-dashboard-plugin"?: ManifestSlice };
		try {
			parsed = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
		} catch {
			continue;
		}
		const manifest = parsed["pi-dashboard-plugin"];
		if (manifest) out.push({ pkg: entry.name, manifest });
	}
	return out;
}

describe("content-view claims are predicate-gated", () => {
	const manifests = readPluginManifests();

	it("finds plugin manifests to check (guard is not vacuous)", () => {
		expect(manifests.length).toBeGreaterThan(5);
	});

	it("finds at least one content-view claim to check (guard is not vacuous)", () => {
		const contentViewClaims = manifests.flatMap(({ manifest }) =>
			(manifest.claims ?? []).filter((c) => c.slot === "content-view"),
		);
		expect(contentViewClaims.length).toBeGreaterThan(0);
	});

	it("every content-view claim declares a predicate", () => {
		const offenders: string[] = [];
		for (const { pkg, manifest } of manifests) {
			for (const claim of manifest.claims ?? []) {
				if (claim.slot !== "content-view") continue;
				if (typeof claim.predicate === "string" && claim.predicate.length > 0) {
					continue;
				}
				offenders.push(
					`  - packages/${pkg} (plugin "${manifest.id}") ` +
						`claims content-view with component "${claim.component}" and no predicate`,
				);
			}
		}
		expect(
			offenders.length,
			"A content-view claim without a predicate renders for EVERY session and\n" +
				"occludes the chat (it wins the `?? sessionDetail` fallback in App.tsx).\n" +
				"Add a `predicate` naming an exported function, or use `command-route`\n" +
				"if the view should open on demand from the palette.\n\n" +
				offenders.join("\n"),
		).toBe(0);
	});
});

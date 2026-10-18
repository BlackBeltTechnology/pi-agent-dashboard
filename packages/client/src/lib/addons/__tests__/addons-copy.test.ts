/**
 * ui-terminology: new Add-ons copy never says "spawn". Token guard is run
 * separately (`node scripts/theme-token-guard.mjs`).
 * See change: addons-hub-feature-catalog (test-plan #E31).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../..");
const FILES = [
	"components/packages/AddonFeatureRow.tsx",
	"components/packages/AddonToggleConfirm.tsx",
	"components/packages/AddonsUpdatesTab.tsx",
	"components/packages/AddonsDiscoverTab.tsx",
	"components/packages/AddonsExplainer.tsx",
	"components/packages/UnifiedPackagesSection.tsx",
	"lib/addons/addon-feature-helpers.ts",
	"lib/i18n/i18n-hu.ts",
	"lib/i18n/i18n-zh-CN.ts",
];
const FORBIDDEN = /\b(re)?spawn(s|ed|ing)?\b/i;

describe("Add-ons copy", () => {
	it("E31: contains no spawn wording", () => {
		for (const rel of FILES) {
			const lines = fs.readFileSync(path.join(SRC, rel), "utf-8").split("\n");
			// Only string literals matter; skip comments and identifiers like `spawn` in imports.
			const hits = lines.filter((l) => /["'`].*\b(re)?spawn/i.test(l) && FORBIDDEN.test(l) && !l.trim().startsWith("*") && !l.trim().startsWith("//"));
			expect(hits, rel).toEqual([]);
		}
	});
});

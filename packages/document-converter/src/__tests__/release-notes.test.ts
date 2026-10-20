/**
 * Release-notes guard (change: fix-doc-engine-arm64-chromium): the breaking
 * `MMDC_UNAVAILABLE` contract change must be announced in the root CHANGELOG.
 * The package version is NOT asserted: workspaces release in lockstep
 * (scripts/verify-lockfile-versions.mjs), so release-cut owns the bump.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

describe("document-converter release notes", () => {
  // Section-agnostic: a release cut promotes [Unreleased] to [x.y.z], and the
  // announcement must survive that move, so assert on the bullet itself.
  it("E10: CHANGELOG announces MMDC_UNAVAILABLE in a bullet marked breaking", () => {
    const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
    const bullet = changelog.split(/^- /m).find((b) => b.includes("MMDC_UNAVAILABLE")) ?? "";
    expect(bullet).toContain("MMDC_UNAVAILABLE");
    expect(bullet).toMatch(/breaking/i);
  });
});

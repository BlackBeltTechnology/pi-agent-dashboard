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
  it("E10: CHANGELOG [Unreleased] announces MMDC_UNAVAILABLE as breaking", () => {
    const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
    const unreleased = changelog.split(/^## \[/m)[1] ?? "";
    expect(unreleased).toContain("MMDC_UNAVAILABLE");
    expect(unreleased).toMatch(/breaking/i);
  });
});

/**
 * Release-notes guard (change: fix-doc-engine-arm64-chromium): the breaking
 * `MMDC_UNAVAILABLE` contract change rides the 0.x minor channel and must be
 * announced in the root CHANGELOG.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("document-converter release notes", () => {
  it("E10: version >= 0.10.0 and CHANGELOG mentions MMDC_UNAVAILABLE", () => {
    const { version } = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as { version: string };
    const [maj, min] = version.split(".").map(Number);
    expect(maj > 0 || min >= 10).toBe(true);
    const changelog = readFileSync(join(PKG, "..", "..", "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("MMDC_UNAVAILABLE");
  });
});

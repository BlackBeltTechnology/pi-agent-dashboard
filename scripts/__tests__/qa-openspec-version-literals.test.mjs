/**
 * test-plan E17 guard (refresh-electron-bundled-components, review round 1 B1/B2):
 * every semver literal in the two openspec qa smokes equals the single-source
 * `@fission-ai/openspec` pin.
 *
 * The qa smokes run on a clean VM, so a stale predicate only shows up there. Two
 * of them (`12-openspec-shim.ps1`, `13-openspec-offline-regen.sh`) kept a regex
 * literal `1\.6\.0` while their failure messages were updated, and a plain
 * `git grep 1.6.0` cannot see a backslash-escaped literal. This test normalises
 * escapes before comparing, so the next bump cannot repeat it.
 *
 * See change: refresh-electron-bundled-components.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pin = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "packages/server/package.json"), "utf8")).dependencies[
  "@fission-ai/openspec"
];

/** `1.14.3` and the regex-escaped `1\.14\.3` both count as the same literal. */
const SEMVER_LITERAL = /\d+(?:\\?\.\d+){2}/g;

describe.each(["qa/tests/12-openspec-shim.ps1", "qa/tests/13-openspec-offline-regen.sh"])("%s", (rel) => {
  const text = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

  it("pins the single-source openspec version (an exact pin, not a range)", () => {
    expect(pin).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("carries only the single-source version in every semver literal, escaped or not", () => {
    const literals = (text.match(SEMVER_LITERAL) ?? []).map((l) => l.replaceAll("\\", ""));
    expect(literals.length).toBeGreaterThan(0);
    expect(literals.filter((l) => l !== pin)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { isAffectedNode, isOutOfEnginesRange, isUsableNodeVersion } from "../node-version.js";

// Canonical accept-set (see change: unify-node-version-gate / design D2):
//   usable iff within engines range (>=22.19.0 <26) AND not Fastify-affected.
describe("isUsableNodeVersion", () => {
  const cases: Array<[string, boolean]> = [
    ["v21.9.0", false], // below floor (major < 22)
    ["v22.18.0", false], // below floor + Fastify-affected
    ["v22.18.999", false], // below floor edge
    ["v22.19.0", true], // engines floor exactly — usable
    ["v22.22.2", true], // current 22 LTS
    ["v24.0.0", true], // in range, below affected range
    ["v24.1.0", false], // Fastify-affected lower bound
    ["v24.2.999", false], // Fastify-affected upper bound
    ["v24.3.0", true], // first 24 fixed
    ["v24.15.0", true], // bundled Node — usable
    ["v25.0.0", true], // entire 25.x usable
    ["v25.9.0", true],
    ["v26.0.0", false], // engines cap (>=26)
    ["v27.0.0", false],
  ];

  for (const [version, expected] of cases) {
    it(`${version} -> ${expected ? "usable" : "not usable"}`, () => {
      expect(isUsableNodeVersion(version)).toBe(expected);
    });
  }

  it("accepts versions without the v prefix", () => {
    expect(isUsableNodeVersion("22.19.0")).toBe(true);
    expect(isUsableNodeVersion("22.18.0")).toBe(false);
    expect(isUsableNodeVersion("24.15.0")).toBe(true);
  });

  it("returns false for malformed / non-version input", () => {
    expect(isUsableNodeVersion("")).toBe(false);
    expect(isUsableNodeVersion("not-a-version")).toBe(false);
    expect(isUsableNodeVersion("v22")).toBe(false);
    expect(isUsableNodeVersion("22.19")).toBe(false);
    // valid semver prefix + trailing junk must NOT pass the gate
    expect(isUsableNodeVersion("v22.19.0 extra")).toBe(false);
    expect(isUsableNodeVersion("22.19.0.1")).toBe(false);
  });

  it("accepts node prerelease / build suffixes within range", () => {
    expect(isUsableNodeVersion("v25.0.0-nightly20260101abcdef01")).toBe(true);
    expect(isUsableNodeVersion("v24.3.0+build.7")).toBe(true);
    // prerelease of an affected version is still rejected
    expect(isUsableNodeVersion("v22.18.0-rc.1")).toBe(false);
  });

  it("is the union of the two range predicates", () => {
    for (const [version] of cases) {
      const expected = !isOutOfEnginesRange(version) && !isAffectedNode(version);
      expect(isUsableNodeVersion(version)).toBe(expected);
    }
  });
});

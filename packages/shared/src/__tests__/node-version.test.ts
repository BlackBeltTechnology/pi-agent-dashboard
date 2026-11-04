import { describe, expect, it } from "vitest";
import {
  isAffectedNode,
  isOutOfEnginesRange,
  isUsableNodeVersion,
  MIN_PI_SPAWN_NODE,
  MIN_SERVER_NODE,
  meetsFloor,
} from "../node-version.js";

// Canonical accept-set (change raise-node-floor-to-26, test-plan #E1):
//   usable iff a clean semver within the server engines range (>=26.0.0 <27).
describe("isUsableNodeVersion / isOutOfEnginesRange (server range >=26.0.0 <27)", () => {
  const cases: Array<[string, boolean]> = [
    ["v21.9.0", false],
    ["v22.19.0", false], // former floor — now refused
    ["v24.15.0", false], // Node 24 LTS — refused
    ["v25.9.0", false], // Node 25 — refused
    ["v25.99.99", false],
    ["v26.0.0", true], // floor exactly
    ["v26.11.1", true],
    ["v26.13.0", true],
    ["v27.0.0", false], // cap
  ];

  for (const [version, usable] of cases) {
    it(`${version} -> ${usable ? "usable" : "not usable"}`, () => {
      expect(isUsableNodeVersion(version)).toBe(usable);
      expect(isOutOfEnginesRange(version)).toBe(!usable);
    });
  }

  it("accepts versions without the v prefix", () => {
    expect(isUsableNodeVersion("26.0.0")).toBe(true);
    expect(isUsableNodeVersion("24.15.0")).toBe(false);
  });

  it("returns false for malformed / non-version input", () => {
    for (const bad of ["", "garbage", "not-a-version", "v26", "26.0", "v26.0.0 extra", "26.0.0.1", "node-nightly-xyz"]) {
      expect(isUsableNodeVersion(bad), bad).toBe(false);
    }
  });

  it("accepts node prerelease / build suffixes within range", () => {
    expect(isUsableNodeVersion("v26.1.0-nightly20261101abcdef01")).toBe(true);
    expect(isUsableNodeVersion("v26.0.0+build.7")).toBe(true);
    expect(isUsableNodeVersion("v25.0.0-nightly20260101abcdef01")).toBe(false);
  });

  it("isUsableNodeVersion is exactly !isOutOfEnginesRange for parseable input", () => {
    for (const [version] of cases) {
      expect(isUsableNodeVersion(version)).toBe(!isOutOfEnginesRange(version));
    }
  });
});

// test-plan #E2 — two distinct floors, single defining module.
describe("floor constants", () => {
  it("dashboard server floor is 26.0.0 and pi spawn floor is 22.19.0", () => {
    expect(MIN_SERVER_NODE).toBe("26.0.0");
    expect(MIN_PI_SPAWN_NODE).toBe("22.19.0");
  });

  it("isOutOfEnginesRange's floor half is exactly !meetsFloor(v, MIN_SERVER_NODE)", () => {
    for (const v of ["v22.19.0", "v24.15.0", "v25.99.9", "v26.0.0", "v26.9.9", "v27.0.0"]) {
      const major = Number(v.replace(/^v/, "").split(".")[0]);
      expect(isOutOfEnginesRange(v)).toBe(!meetsFloor(v, MIN_SERVER_NODE) || major >= 27);
    }
  });

  it("raising the server floor did not raise the pi spawn floor", () => {
    expect(meetsFloor("v22.19.0", MIN_PI_SPAWN_NODE)).toBe(true);
    expect(meetsFloor("v22.18.9", MIN_PI_SPAWN_NODE)).toBe(false);
    expect(meetsFloor("v24.15.0", MIN_PI_SPAWN_NODE)).toBe(true);
    expect(meetsFloor("v24.15.0", MIN_SERVER_NODE)).toBe(false);
  });
});

describe("meetsFloor", () => {
  it("compares full triplets, not majors", () => {
    expect(meetsFloor("v22.19.0", "22.19.0")).toBe(true);
    expect(meetsFloor("v22.18.99", "22.19.0")).toBe(false);
    expect(meetsFloor("v26.0.0", "26.0.0")).toBe(true);
    expect(meetsFloor("v25.99.99", "26.0.0")).toBe(false);
    expect(meetsFloor("v22.19.0", "22.19.1")).toBe(false);
  });

  it("rejects unparseable input on either side", () => {
    expect(meetsFloor("garbage", "26.0.0")).toBe(false);
    expect(meetsFloor("v26.0.0", "garbage")).toBe(false);
    expect(meetsFloor("v26.0.0 extra", "26.0.0")).toBe(false);
  });
});

// isAffectedNode stays exported for the pi-session ladder gate only.
describe("isAffectedNode (pi-session ladder gate)", () => {
  const cases: Array<[string, boolean]> = [
    ["v22.18.0", true],
    ["v22.19.0", false],
    ["v24.0.0", false],
    ["v24.1.0", true],
    ["v24.2.999", true],
    ["v24.3.0", false],
    ["v26.0.0", false],
    ["garbage", false],
  ];
  for (const [v, affected] of cases) {
    it(`${v} -> ${affected}`, () => expect(isAffectedNode(v)).toBe(affected));
  }
});

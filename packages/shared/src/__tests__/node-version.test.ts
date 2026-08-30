import { describe, expect, it } from "vitest";
import {
  isAffectedNode,
  meetsFloor,
  MIN_SUPPORTED_NODE,
  isOutOfEnginesRange,
  isUsableNodeVersion,
} from "../node-version.js";

// Canonical accept-set (see change: unify-node-version-gate / design D2):
//   usable iff within engines range (>=22.19.0 <27) AND not Fastify-affected.
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
    ["v26.0.0", true], // in range since the cap raise (<26 -> <27)
    ["v27.0.0", false], // engines cap (>=27)
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

// Lockstep contract (change unify-pi-runtime-identity task 1.1): MIN_SUPPORTED_NODE
// is the single defining occurrence of the floor; isOutOfEnginesRange's floor half
// is implemented THROUGH meetsFloor + MIN_SUPPORTED_NODE so no second literal can
// drift. The test below asserts constant ⇄ predicate agreement on every boundary
// that matters.
describe("MIN_SUPPORTED_NODE ⇄ isOutOfEnginesRange lockstep", () => {
  const sweep = [
    "v21.9.9",
    "v22.18.9", // one below the floor — the boundary the constant encodes
    "v22.19.0", // the floor exactly
    "v22.19.1",
    "v23.0.0",
    "v24.15.0",
    "v26.9.9",
    "v27.0.0", // past the cap — floor says yes, cap says no
  ];

  it("constant parses to the documented floor 22.19.0", () => {
    expect(meetsFloor("v22.19.0", MIN_SUPPORTED_NODE)).toBe(true);
    expect(meetsFloor("v22.18.9", MIN_SUPPORTED_NODE)).toBe(false);
  });

  it("isOutOfEnginesRange's floor half is exactly !meetsFloor(v, MIN_SUPPORTED_NODE)", () => {
    for (const v of sweep) {
      const major = Number(v.replace(/^v/, "").split(".")[0]);
      const capExcess = major >= 27;
      const expected = !meetsFloor(v, MIN_SUPPORTED_NODE) || capExcess;
      expect(isOutOfEnginesRange(v)).toBe(expected);
    }
  });

  it("meetsFloor compares full triplets, not majors", () => {
    expect(meetsFloor("v22.19.0", "22.19.0")).toBe(true);
    expect(meetsFloor("v22.18.99", "22.19.0")).toBe(false);
    expect(meetsFloor("v23.0.0", "22.19.0")).toBe(true);
    expect(meetsFloor("v25.8.1", "22.19.0")).toBe(true);
    expect(meetsFloor("v22.19.0", "22.19.1")).toBe(false);
  });

  it("meetsFloor rejects unparseable input on either side", () => {
    expect(meetsFloor("garbage", "22.19.0")).toBe(false);
    expect(meetsFloor("v22.19.0", "garbage")).toBe(false);
    expect(meetsFloor("v22.19.0 extra", "22.19.0")).toBe(false);
  });

  it("floor boundary behaves per the accept-set (22.18 rejected, 22.19 accepted)", () => {
    expect(isOutOfEnginesRange("v22.18.9")).toBe(true);
    expect(isOutOfEnginesRange("v22.19.0")).toBe(false);
  });
});

// Engines-cap boundary, asserted directly on isOutOfEnginesRange — the accept-set
// table above only drives isUsableNodeVersion.
// See change: fix-pi-install-node26-and-omit-dev-build (test-plan #E1/#E2/#E3).
describe("engines cap boundary (<27)", () => {
  it("Node 26 is inside the engines range and usable", () => {
    for (const v of ["v26.0.0", "v26.5.0"]) {
      expect(isOutOfEnginesRange(v)).toBe(false);
      expect(isUsableNodeVersion(v)).toBe(true);
    }
  });

  it("Node 27 is the new refusal boundary", () => {
    expect(isOutOfEnginesRange("v27.0.0")).toBe(true);
    expect(isUsableNodeVersion("v27.0.0")).toBe(false);
  });

  it("leaves the floor and the Fastify-affected range untouched", () => {
    expect(isUsableNodeVersion("v22.19.0")).toBe(true);
    expect(isUsableNodeVersion("v22.18.0")).toBe(false);
    expect(isUsableNodeVersion("v24.2.0")).toBe(false);
  });
});

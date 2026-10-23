import { describe, expect, it } from "vitest";
import { isValidHostApiRange, PLUGIN_HOST_API_VERSION, satisfiesHostApi, satisfiesHostApiRange } from "../host-api.js";

describe("PLUGIN_HOST_API_VERSION", () => {
  it("is the current 1.3.0 contract", () => {
    expect(PLUGIN_HOST_API_VERSION).toBe("1.3.0");
  });
});

describe("satisfiesHostApiRange (host 1.3.0)", () => {
  const cases: Array<[string, boolean]> = [
    ["^1.0.0", true],
    ["^1.2", true],
    ["^1.2.0", true],
    ["^1.2.1", true],
    ["^1.3.0", true],
    ["^1.3.1", false],
    ["^1.4.0", false],
    ["^1.9.0", false],
    ["^2.0.0", false],
    ["^0.9.0", false],
    ["1.3.0", true],
    ["1.3.1", false],
  ];
  it.each(cases)("%s → %s", (range, expected) => {
    expect(satisfiesHostApiRange("1.3.0", range)).toBe(expected);
  });

  it("caret on 0.x pins the minor; on 0.0.x pins the patch", () => {
    expect(satisfiesHostApiRange("0.9.4", "^0.9.0")).toBe(true);
    expect(satisfiesHostApiRange("0.10.0", "^0.9.0")).toBe(false);
    expect(satisfiesHostApiRange("0.0.3", "^0.0.3")).toBe(true);
    expect(satisfiesHostApiRange("0.0.4", "^0.0.3")).toBe(false);
  });

  it("malformed range or version never satisfies", () => {
    for (const bad of ["^1", ">=1.0.0", "~1.2.0", "1.x", "latest", "", "^1.2.3.4", "^01.2.0", "v1.2.0", "1.2"]) {
      expect(satisfiesHostApiRange("1.2.0", bad)).toBe(false);
    }
    expect(satisfiesHostApiRange("1.2", "^1.0.0")).toBe(false);
    expect(satisfiesHostApiRange("latest", "^1.0.0")).toBe(false);
  });
});

describe("isValidHostApiRange", () => {
  it("accepts ^MAJOR.MINOR[.PATCH] and exact MAJOR.MINOR.PATCH only", () => {
    for (const ok of ["^1.0.0", "^1.2", "^0.9.0", "1.2.0"]) expect(isValidHostApiRange(ok)).toBe(true);
    for (const bad of ["^1", ">=1.0.0", "~1.2.0", "1.x", "latest", "", "1.2", 42, null, undefined]) {
      expect(isValidHostApiRange(bad)).toBe(false);
    }
  });
});

describe("satisfiesHostApi", () => {
  it("is bound to PLUGIN_HOST_API_VERSION", () => {
    expect(satisfiesHostApi("^1.0.0")).toBe(true);
    expect(satisfiesHostApi("^1.4.0")).toBe(false);
    expect(satisfiesHostApi("^2.0.0")).toBe(false);
  });
});

/**
 * Manifest `emits` validation: static list of exact event names a plugin may
 * emit into sessions. Rejects non-lists, empty/whitespace entries, reserved
 * host prefixes (case-insensitive) and over-size lists.
 * See change: harden-git-terminal-plugin-boundaries (D16; test-plan #SE22, #SE23, #SE43).
 */
import { describe, expect, it } from "vitest";
import { ManifestValidationError, validateManifest } from "../manifest-validator.js";

const base = { id: "x", displayName: "X", claims: [] };
const withEmits = (emits: unknown) => ({ ...base, emits });

function expectRejected(emits: unknown): void {
  let err: unknown;
  try {
    validateManifest(withEmits(emits));
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ManifestValidationError);
  expect((err as Error).message).toContain("emits");
}

describe("manifest validator — emits shape (SE22)", () => {
  it("accepts an absent emits and an empty list", () => {
    expect(validateManifest(base).emits).toBeUndefined();
    expect(validateManifest(withEmits([])).emits).toEqual([]);
  });

  it("accepts a valid list and keeps it verbatim", () => {
    const m = validateManifest(withEmits(["flow:run", "dashboard-flows:report-files"]));
    expect(m.emits).toEqual(["flow:run", "dashboard-flows:report-files"]);
  });

  it.each([
    ["a bare string", "flow:run"],
    ["an empty-string entry", [""]],
    ["a number entry", [1]],
    ["null", null],
    ["an object", {}],
    ["a valid + empty entry", ["a", ""]],
    ["a nested list", [["a"]]],
  ])("rejects %s naming emits", (_label, value) => {
    expectRejected(value);
  });
});

describe("manifest validator — emits reserved prefixes (SE23)", () => {
  it.each(["roles:set", "role:x", "model:x", "prompt:x", "dashboard:x", "ui:x"])("rejects reserved %s", (t) => {
    expectRejected([t]);
  });

  it("rejects a mixed list containing a reserved entry", () => {
    expectRejected(["flow:run", "roles:set"]);
  });

  it.each(["flow:run", "dashboard-flows:report-files", "roles", "flow:*"])("accepts %s as a literal name", (t) => {
    expect(validateManifest(withEmits([t])).emits).toEqual([t]);
  });
});

describe("manifest validator — emits limits (SE43)", () => {
  it.each([
    ["case-variant reserved prefix", ["ROLES:set"]],
    ["leading whitespace", [" roles:set"]],
    ["blank entry", [" "]],
    ["inner whitespace", ["a b"]],
    ["empty entry", [""]],
    ["65 entries", Array.from({ length: 65 }, (_, i) => `ev:${i}`)],
    ["10 000 entries", Array.from({ length: 10_000 }, (_, i) => `ev:${i}`)],
    ["a 129-char name", ["a".repeat(129)]],
    ["a 5 000-char name", ["a".repeat(5_000)]],
  ])("rejects %s", (_label, value) => {
    expectRejected(value);
  });

  it("accepts exactly 64 entries and a 128-char name", () => {
    const sixtyFour = Array.from({ length: 64 }, (_, i) => `ev:${i}`);
    expect(validateManifest(withEmits(sixtyFour)).emits).toEqual(sixtyFour);
    const long = ["a".repeat(128)];
    expect(validateManifest(withEmits(long)).emits).toEqual(long);
  });
});

/**
 * TypeBox 1.3.7 breaking bump (#7243) — the live risk is the fix to compiled
 * validation of NULLABLE-ARRAY tool arguments, NOT schema `anyOf` emission.
 * The extension's optional-array tool arg is `ask-user` `options:
 * Type.Optional(Type.Array(Type.String()))`. This test validates that shape
 * against the RUNTIME typebox (devDep bumped to ^1.3.7 so tests hit the same
 * validator pi uses) across the three argument shapes.
 *
 * See change: update-pi-core-0-83-adopt-apis (test-plan #E12-#E14).
 */
import { Type } from "typebox";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";

// Mirror of ask-user-tool.ts's optional-array arg (the nullable-array shape).
const Schema = Type.Object({
  method: Type.String(),
  options: Type.Optional(Type.Array(Type.String())),
});

describe("TypeBox 1.3.7 nullable-array tool-arg validation", () => {
  it("E12: options omitted → accepted (optional field absent is valid)", () => {
    expect(Value.Check(Schema, { method: "select" })).toBe(true);
  });

  it("E14: options as a valid string array → accepted", () => {
    expect(Value.Check(Schema, { method: "select", options: ["a", "b"] })).toBe(true);
  });

  it("E13: options null → rejected (Optional means absent-or-typed, not null)", () => {
    // The 1.3.7 fix makes compiled validation of the nullable-array case
    // consistent: an explicit null is NOT a valid Array — this must reject,
    // and must reject the same way the runtime validator does.
    expect(Value.Check(Schema, { method: "select", options: null })).toBe(false);
  });

  it("options with a non-string element → rejected", () => {
    expect(Value.Check(Schema, { method: "select", options: ["a", 1] })).toBe(false);
  });
});

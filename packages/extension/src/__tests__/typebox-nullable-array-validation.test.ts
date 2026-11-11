/**
 * Tool-argument validation of the `ask_user` optional-array shape, driven
 * through pi-ai's exported `validateToolArguments` — the function pi's agent
 * loop calls. Since pi 1.5.0 it validates with `@earendil-works/pi-schema`
 * (`compile(schema, { coerce: true })`), not TypeBox: an optional `null` is
 * dropped, a single value is wrapped into an array, array elements are coerced,
 * and errors read `- <path>: <message>` under the unchanged
 * `Validation failed for tool "<name>":` prefix. The schema is built with
 * `typebox` `Type`, as `ask-user-tool.ts` builds it, so this also proves
 * pi-schema accepts a TypeBox-built JSON Schema.
 *
 * Replaces the TypeBox `Value.Check` test of update-pi-core-0-83-adopt-apis
 * (test-plan #E12-#E14), whose "same validator pi uses" claim no longer held.
 * See change: update-pi-core-1-5-adopt-apis (test-plan #E35 #E36).
 */
import { validateToolArguments } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";

// Mirror of ask-user-tool.ts's optional-array arg.
const tool = {
  name: "ask_user",
  description: "ask the user",
  parameters: Type.Object({
    method: Type.String(),
    options: Type.Optional(Type.Array(Type.String())),
  }),
};

const call = (args: Record<string, unknown>) => ({ type: "toolCall", id: "c1", name: "ask_user", arguments: args });
const validate = (args: Record<string, unknown>) => validateToolArguments(tool, call(args));

describe("pi 1.5 tool-argument validation (pi-ai validateToolArguments)", () => {
  it("E35: options omitted → accepted unchanged", () => {
    expect(validate({ method: "select" })).toEqual({ method: "select" });
  });

  it("E35: a valid string array → accepted unchanged", () => {
    expect(validate({ method: "select", options: ["a", "b"] })).toEqual({ method: "select", options: ["a", "b"] });
  });

  it("E35: options null → the optional value is dropped", () => {
    expect(validate({ method: "select", options: null })).toEqual({ method: "select" });
  });

  it("E35: a single value → wrapped into an array", () => {
    expect(validate({ method: "select", options: "a" })).toEqual({ method: "select", options: ["a"] });
  });

  it("E35: a mixed array → elements coerced to strings", () => {
    expect(validate({ method: "select", options: ["a", 1] })).toEqual({ method: "select", options: ["a", "1"] });
  });

  it("E36: a missing required field → pi-schema wording under the unchanged prefix", () => {
    expect(() => validate({})).toThrowError(/^Validation failed for tool "ask_user":\n {2}- method: missing/);
  });
});

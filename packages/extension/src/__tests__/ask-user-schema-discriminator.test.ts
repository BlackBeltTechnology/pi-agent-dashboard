/**
 * Regression guard for the `ask_user` tool's parameters JSON Schema shape.
 *
 * History:
 *   1. Pre-a53933f — schema was `Type.Union` of per-method `Type.Object`
 *      arms (root-level `anyOf`). Anthropic loved it; OpenAI rejected it
 *      ("schema must be a JSON Schema of 'type: \"object\"', got
 *      'type: \"None\"'").
 *
 *   2. a53933f — collapsed to a single flat `Type.Object` (root
 *      `type: "object"`, all fields optional). OpenAI happy. Anthropic
 *      lost its per-method strictness; Claude started emitting
 *      multiselect calls without `options` and the dashboard auto-
 *      cancelled them — the user-visible bug behind
 *      fix-multiselect-auto-cancel-on-dashboard.
 *
 *   3. Layer-2 attempt of fix-multiselect-auto-cancel-on-dashboard —
 *      tried to keep root `type: "object"` AND attach a body-level
 *      `oneOf` discriminator over `method`. Anthropic worked. Real
 *      OpenAI gpt-5 rejected it (verified 2026-04-30) with: "schema
 *      must have type 'object' and not have 'oneOf' / 'anyOf' / 'allOf'
 *      / 'enum' / 'not' at the top level." The fallback documented in
 *      tasks.md §9.7 was taken: Layer 2 dropped, Layer 1 (multiselect
 *      dashboard routing) ships alone — that's what actually fixes the
 *      user bug.
 *
 * This test pins the post-fallback shape so it cannot regress in
 * either direction:
 *   • Root MUST be `type: "object"` (OpenAI rule).
 *   • Root MUST NOT have `oneOf`, `anyOf`, `allOf`, `enum`, `not`.
 *   • The same five forbidden keys MUST NOT appear on `SubQuestionSchema`
 *     either — OpenAI applies the rule recursively per the error message.
 *
 * Per-method strictness is enforced by `prepareArguments` rescue + the
 * `execute` runtime switch (covered by `ask-user-tool.test.ts`).
 *
 * See change: fix-multiselect-auto-cancel-on-dashboard.
 */
import { describe, it, expect, vi } from "vitest";
import { registerAskUserTool } from "../ask-user-tool.js";

const FORBIDDEN_TOP_LEVEL_KEYS = ["oneOf", "anyOf", "allOf", "enum", "not"] as const;

interface PiSchema {
  type?: string;
  properties?: Record<string, any>;
  required?: string[];
  description?: string;
  oneOf?: unknown;
  anyOf?: unknown;
  allOf?: unknown;
  enum?: unknown;
  not?: unknown;
}

function captureRegisteredTool() {
  const calls: any[] = [];
  const pi = {
    registerTool: vi.fn((def: any) => calls.push(def)),
  };
  registerAskUserTool(pi as any);
  expect(calls.length).toBe(1);
  return calls[0];
}

function getSubQuestionSchema(parameters: PiSchema): PiSchema {
  const items = parameters.properties?.questions?.items;
  expect(items).toBeDefined();
  return items as PiSchema;
}

// Walk a Union<Literal> schema (typebox emits it as `anyOf` of `{const: ...}`)
// into a flat list of literal values.
function flattenUnionLiterals(s: any): string[] {
  if (!s) return [];
  if (Array.isArray(s.anyOf)) return s.anyOf.flatMap(flattenUnionLiterals);
  if (s.const !== undefined) return [String(s.const)];
  return [];
}

describe("ask_user parameters schema — OpenAI strict-mode shape", () => {
  it("root is type:object", () => {
    const tool = captureRegisteredTool();
    const params = tool.parameters as PiSchema;
    expect(params.type).toBe("object");
  });

  it.each(FORBIDDEN_TOP_LEVEL_KEYS)(
    "root has NO `%s` (OpenAI strict mode forbids it at the top level)",
    (key) => {
      const tool = captureRegisteredTool();
      const params = tool.parameters as Record<string, unknown>;
      expect(
        params[key],
        `parameters.${key} would break OpenAI gpt-5: "schema must have type 'object' and not have 'oneOf' / 'anyOf' / 'allOf' / 'enum' / 'not' at the top level."`,
      ).toBeUndefined();
    },
  );

  it("declares the five method literals (regression guard for MethodEnum)", () => {
    const tool = captureRegisteredTool();
    const methodSchema = (tool.parameters as PiSchema).properties?.method;
    expect(methodSchema).toBeDefined();
    // typebox emits a Union<Literal> as `anyOf` UNDER `properties.method`
    // (NOT at the schema root). That is OpenAI-legal because it isn't at
    // the top level. We only assert the literal set is preserved.
    const methods = flattenUnionLiterals(methodSchema);
    expect(methods).toEqual(
      expect.arrayContaining(["confirm", "select", "multiselect", "input", "batch"]),
    );
  });
});

describe("ask_user SubQuestionSchema — OpenAI strict-mode shape", () => {
  it("sub-question schema is type:object", () => {
    const tool = captureRegisteredTool();
    const sq = getSubQuestionSchema(tool.parameters);
    expect(sq.type).toBe("object");
  });

  it.each(FORBIDDEN_TOP_LEVEL_KEYS)(
    "sub-question schema has NO `%s` at top level (OpenAI rule applies recursively)",
    (key) => {
      const tool = captureRegisteredTool();
      const sq = getSubQuestionSchema(tool.parameters) as Record<string, unknown>;
      expect(sq[key]).toBeUndefined();
    },
  );

  it("sub-question excludes 'batch' from method literals (no nesting)", () => {
    const tool = captureRegisteredTool();
    const sq = getSubQuestionSchema(tool.parameters);
    const methodSchema = sq.properties?.method;
    expect(methodSchema).toBeDefined();
    const methods = flattenUnionLiterals(methodSchema);
    expect(methods).toEqual(
      expect.arrayContaining(["confirm", "select", "multiselect", "input"]),
    );
    expect(methods).not.toContain("batch");
  });
});

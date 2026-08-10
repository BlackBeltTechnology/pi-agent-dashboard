/**
 * Shared `flattenModelsJson` reader: nested native flatten + parent-key
 * precedence + legacy shapes + per-provider defensiveness.
 *
 * See change: honor-native-models-json-metadata (test-plan E1/E2/E3/X1).
 */
import { describe, expect, it } from "vitest";
import { flattenModelsJson } from "../models-json-reader.js";

describe("flattenModelsJson — native nested flatten (E1)", () => {
  it("flattens providers.<p>.models[] stamping the parent provider, carrying all fields", () => {
    const map = { minimal: null, xhigh: "xhigh", max: "max" };
    const compat = { thinkingFormat: "deepseek", supportsReasoningEffort: true };
    const out = flattenModelsJson({
      providers: {
        newapi: {
          models: [
            {
              id: "glm-5.2",
              contextWindow: 200000,
              maxTokens: 65536,
              reasoning: true,
              thinkingLevelMap: map,
              compat,
              input: ["text", "image"],
              cost: { input: 1, output: 2 },
            },
          ],
        },
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      provider: "newapi",
      id: "glm-5.2",
      contextWindow: 200000,
      maxTokens: 65536,
      reasoning: true,
      thinkingLevelMap: map,
      compat,
      input: ["text", "image"],
      cost: { input: 1, output: 2 },
    });
  });
});

describe("flattenModelsJson — parent key wins over in-entry provider (E2)", () => {
  it("stamps the parent provider key, not the entry's own provider field", () => {
    const out = flattenModelsJson({
      providers: { newapi: { models: [{ id: "glm-5.2", provider: "other" }] } },
    });
    expect(out).toHaveLength(1);
    expect(out[0].provider).toBe("newapi");
  });
});

describe("flattenModelsJson — legacy shapes + nested wins on collision (E3)", () => {
  it("accepts a legacy top-level array", () => {
    const out = flattenModelsJson([{ provider: "newapi", id: "glm-5.2", maxTokens: 8192 }]);
    expect(out).toEqual([{ provider: "newapi", id: "glm-5.2", maxTokens: 8192 }]);
  });

  it("accepts a legacy { models: [] } object", () => {
    const out = flattenModelsJson({ models: [{ provider: "newapi", id: "glm-5.2", maxTokens: 8192 }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ provider: "newapi", id: "glm-5.2", maxTokens: 8192 });
  });

  it("nested native entry wins over a legacy top-level entry on provider/id collision", () => {
    const out = flattenModelsJson({
      models: [{ provider: "newapi", id: "glm-5.2", maxTokens: 8192 }],
      providers: { newapi: { models: [{ id: "glm-5.2", maxTokens: 65536 }] } },
    });
    expect(out).toHaveLength(1);
    expect(out[0].maxTokens).toBe(65536);
  });
});

describe("flattenModelsJson — per-provider defensiveness (X1)", () => {
  it("a malformed provider block yields no entries for that block but keeps others", () => {
    const out = flattenModelsJson({
      providers: {
        bad: { models: "not-an-array" },
        good: { models: [{ id: "m1" }] },
      },
    });
    expect(out).toEqual([{ provider: "good", id: "m1" }]);
  });

  it("entries without a string id are skipped", () => {
    const out = flattenModelsJson({ providers: { p: { models: [{ noId: true }, { id: "" }, { id: "ok" }] } } });
    expect(out).toEqual([{ provider: "p", id: "ok" }]);
  });

  it("non-object input returns []", () => {
    expect(flattenModelsJson(null)).toEqual([]);
    expect(flattenModelsJson("x")).toEqual([]);
    expect(flattenModelsJson(42)).toEqual([]);
  });
});

/**
 * pi 0.84.0 added advanced custom-model sampling: arbitrary OpenAI-compatible
 * `samplingParams` (and opt-in vLLM `thinking_token_budget`) on a model config.
 * `NativeModelEntry` is the dashboard's `models.json` shape, so the field must
 * survive the read or a user's sampling config is silently dropped before it
 * ever reaches pi.
 *
 * See change: update-pi-core-0-84-adopt-apis (task 8.3).
 */
describe("flattenModelsJson — samplingParams passthrough (pi 0.84.x)", () => {
  it("carries samplingParams through the flattened entry", () => {
    const out = flattenModelsJson({
      providers: {
        "my-vllm": {
          models: [
            {
              id: "qwen",
              contextWindow: 32768,
              samplingParams: { top_k: 40, thinking_token_budget: 2048 },
            },
          ],
        },
      },
    });

    expect(out).toHaveLength(1);
    expect(out[0].samplingParams).toEqual({ top_k: 40, thinking_token_budget: 2048 });
  });

  it("leaves samplingParams undefined when the entry omits it", () => {
    const out = flattenModelsJson({ providers: { p: { models: [{ id: "m" }] } } });
    expect(out[0].samplingParams).toBeUndefined();
  });
});

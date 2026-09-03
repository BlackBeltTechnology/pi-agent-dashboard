import { describe, expect, it } from "vitest";
import { catalogueRowToModelInfo, mergeModelOptions } from "../model-catalogue.js";
import type { ModelInfo } from "../types.js";

describe("catalogueRowToModelInfo", () => {
  it("strips the provider prefix from a slashed model id (test-plan #E6)", () => {
    expect(
      catalogueRowToModelInfo({ provider: "openrouter", id: "openrouter/meta-llama/llama-3-70b" }),
    ).toEqual({ provider: "openrouter", id: "meta-llama/llama-3-70b" });
  });

  it("does not split on the first slash for a provider name containing one (test-plan #E7)", () => {
    expect(catalogueRowToModelInfo({ provider: "my/proxy", id: "my/proxy/some-model" })).toEqual({
      provider: "my/proxy",
      id: "some-model",
    });
  });

  it("maps input including image to vision true (test-plan #E8)", () => {
    expect(
      catalogueRowToModelInfo({ provider: "openai", id: "openai/gpt-5", input: ["text", "image"] }).vision,
    ).toBe(true);
  });

  it("maps text-only input to vision false (test-plan #E9)", () => {
    expect(catalogueRowToModelInfo({ provider: "openai", id: "openai/gpt-5", input: ["text"] }).vision).toBe(
      false,
    );
  });

  it("leaves vision undefined and does not throw when input is absent (test-plan #E10)", () => {
    const result = catalogueRowToModelInfo({ provider: "openai", id: "openai/gpt-5" });
    expect(result.vision).toBeUndefined();
    expect(result).toEqual({ provider: "openai", id: "gpt-5" });
  });

  it("projects only the honest fields (test-plan #E11)", () => {
    const result = catalogueRowToModelInfo({
      provider: "openai",
      id: "openai/gpt-5",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 400000,
      maxTokens: 128000,
      thinkingLevelMap: { high: "high" },
      cost: { input: 1 },
    });
    expect(result).toEqual({
      provider: "openai",
      id: "gpt-5",
      reasoning: true,
      vision: true,
      contextWindow: 400000,
    });
    for (const dropped of ["metadataSource", "supportedThinkingLevels", "thinkingLevelMap", "maxTokens", "cost"]) {
      expect(result).not.toHaveProperty(dropped);
    }
  });
});

const A: ModelInfo = { provider: "openai", id: "gpt-5" };
const B: ModelInfo = { provider: "anthropic", id: "claude-4" };

describe("mergeModelOptions", () => {
  it("with zero sessions the union is the catalogue (test-plan #E1)", () => {
    expect(mergeModelOptions([A], [])).toEqual([A]);
  });

  it("is a superset of the session-only list (test-plan #E2)", () => {
    const options = mergeModelOptions([A], [B]);
    expect(options).toHaveLength(2);
    expect(new Set(options.map((m) => `${m.provider}/${m.id}`))).toEqual(
      new Set(["openai/gpt-5", "anthropic/claude-4"]),
    );
  });

  it("session row wins on collision (test-plan #E3)", () => {
    const options = mergeModelOptions(
      [{ provider: "openai", id: "gpt-5" }],
      [{ provider: "openai", id: "gpt-5", name: "GPT-5", metadataSource: "catalog" }],
    );
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ name: "GPT-5", metadataSource: "catalog" });
  });

  it("keeps env-credentialed session models when the catalogue is empty (test-plan #E4)", () => {
    expect(mergeModelOptions([], [B])).toEqual([B]);
  });

  it("dedupes the same model reported by two sessions (test-plan #E5)", () => {
    expect(mergeModelOptions([A], [A, A])).toEqual([A]);
  });

  it("diverges from the catalogue-only proxy list (test-plan #E12)", () => {
    const catalogue = [A];
    expect(mergeModelOptions(catalogue, [B])).toHaveLength(2);
    expect(catalogue).toEqual([A]);
  });

  it("builds a large union without quadratic blowup (test-plan #P2)", () => {
    const catalogue: ModelInfo[] = Array.from({ length: 500 }, (_, i) => ({ provider: "p", id: `c${i}` }));
    const sessions: ModelInfo[] = Array.from({ length: 10 * 200 }, (_, i) => ({
      provider: "p",
      id: `s${i % 200}`,
    }));
    const samples: number[] = [];
    for (let run = 0; run < 100; run++) {
      const t0 = performance.now();
      mergeModelOptions(catalogue, sessions);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(50);
  });
});

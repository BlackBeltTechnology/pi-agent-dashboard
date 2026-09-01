/**
 * toModelInfo projects pi 0.72+'s per-model `thinkingLevelMap` into
 * `supportedThinkingLevels` via pi's canonical `getSupportedThinkingLevels`.
 * The map is a SPARSE override table: unmentioned levels stay supported, `null`
 * disables a level, `xhigh` needs an explicit non-null entry, and a
 * non-reasoning model supports only `off`. Models with no thinking metadata →
 * undefined (client falls back to all six).
 *
 * See change: fix-thinking-level-supported-projection.
 */
import { describe, expect, it } from "vitest";
import { deriveSupportedThinkingLevels, toModelInfo } from "../provider-register.js";

const ALL_SIX = ["off", "minimal", "low", "medium", "high", "xhigh"];

describe("toModelInfo — supportedThinkingLevels projection", () => {
  it("sparse reasoning map (Opus) surfaces all non-disabled levels", () => {
    const info = toModelInfo({
      provider: "anthropic",
      id: "claude-opus-4-8",
      reasoning: true,
      thinkingLevelMap: { xhigh: "xhigh" },
    });
    expect(info.supportedThinkingLevels).toEqual(ALL_SIX);
  });

  it("dense map drops only the null-disabled level (xhigh)", () => {
    const info = toModelInfo({
      provider: "anthropic",
      id: "claude",
      reasoning: true,
      thinkingLevelMap: { medium: "medium", high: "high", xhigh: null },
    });
    expect(info.supportedThinkingLevels).toEqual(["off", "minimal", "low", "medium", "high"]);
  });

  it("non-reasoning model supports only off", () => {
    const info = toModelInfo({ provider: "openai", id: "gpt", reasoning: false });
    expect(info.supportedThinkingLevels).toEqual(["off"]);
  });

  it("reasoning model with no map supports all but xhigh (xhigh needs an explicit entry)", () => {
    const info = toModelInfo({ provider: "anthropic", id: "sonnet", reasoning: true });
    expect(info.supportedThinkingLevels).toEqual(["off", "minimal", "low", "medium", "high"]);
  });

  it("leaves supportedThinkingLevels undefined when no thinking metadata", () => {
    const info = toModelInfo({ provider: "openai", id: "gpt" });
    expect(info.supportedThinkingLevels).toBeUndefined();
  });

  it("never projects compat or credential material into ModelInfo (S1/§7.1)", () => {
    const info = toModelInfo({
      provider: "newapi",
      id: "glm-5.2",
      reasoning: true,
      thinkingLevelMap: { xhigh: "xhigh" },
      compat: { thinkingFormat: "deepseek" },
      apiKey: "sk-secret",
    });
    expect(JSON.stringify(info)).not.toMatch(/compat|thinkingFormat|deepseek|apiKey|sk-secret/i);
  });

  it("native thinkingLevelMap flows through toModelInfo (F1)", () => {
    // Test runtime is pi-ai 0.75.5 (no `max`), so `max` is never surfaced here.
    const info = toModelInfo({
      provider: "newapi",
      id: "glm-5.2",
      reasoning: true,
      thinkingLevelMap: { xhigh: "xhigh" },
    });
    expect(info.supportedThinkingLevels).toEqual(ALL_SIX);
  });
});

// SYNTHETIC table (NOT the pinned pi-ai 0.75.5 fn, which has no `max` branch):
// max is opt-in AND runtime-gated, fail-CLOSED. See change:
// honor-native-models-json-metadata (test-plan E11).
describe("deriveSupportedThinkingLevels — runtime-gated max (E11)", () => {
  const MAX_ONLY = { minimal: null, low: null, medium: null, high: null, xhigh: null, max: "max" };

  it("emits max only when maxSupported AND the map opts in", () => {
    expect(deriveSupportedThinkingLevels(true, MAX_ONLY, true)).toEqual(["off", "max"]);
    expect(deriveSupportedThinkingLevels(true, MAX_ONLY, false)).toEqual(["off"]);
  });

  it("never emits max when the map omits it, even on a max-capable runtime", () => {
    expect(deriveSupportedThinkingLevels(true, { xhigh: "xhigh" }, true)).toEqual(ALL_SIX);
  });

  it("reasoning model with no map supports all levels except xhigh and max", () => {
    expect(deriveSupportedThinkingLevels(true, undefined, true)).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
    ]);
  });

  it("non-reasoning model supports only off", () => {
    expect(deriveSupportedThinkingLevels(false, MAX_ONLY, true)).toEqual(["off"]);
  });
});

// ── Endpoint-advertised thinking capability ───────────────────────────────
//
// A provider that advertises `reasoning: true` with an underdetermined range
// (`thinkingRange: null`) restores level AVAILABILITY without a synthesized
// map: absent means downstream applies its existing defaults, which is exactly
// what every native model with no map already does. A guessed table would
// replace "no thinking levels" with "wrong thinking levels".
// See change: fix-custom-provider-model-metadata (test-plan E11/E12).

describe("toModelInfo — endpoint reasoning without a synthesized map (E11)", () => {
  it("reasoning:true with no map yields the full canonical level set", () => {
    const info = toModelInfo({ provider: "proxy", id: "cc/claude-opus-5", reasoning: true });
    // No map declared → nothing is disabled except the opt-in tiers.
    expect(info.supportedThinkingLevels).toContain("high");
    expect(info.supportedThinkingLevels).toContain("off");
    expect(info.reasoning).toBe(true);
  });

  it("reasoning:false still collapses to off only (the bug this change ends)", () => {
    const info = toModelInfo({ provider: "proxy", id: "cc/claude-opus-5", reasoning: false });
    expect(info.supportedThinkingLevels).toEqual(["off"]);
  });

  it("a native map still wins over the endpoint's bare reasoning flag (E12)", () => {
    // registerEntry resolves native metadata ahead of advertised metadata, so a
    // model carrying a native map projects that map, not a synthesized one.
    const info = toModelInfo({
      provider: "proxy",
      id: "cc/claude-opus-5",
      reasoning: true,
      thinkingLevelMap: { minimal: null, xhigh: "xhigh" },
    });
    expect(info.supportedThinkingLevels).not.toContain("minimal");
    expect(info.supportedThinkingLevels).toContain("xhigh");
  });
});

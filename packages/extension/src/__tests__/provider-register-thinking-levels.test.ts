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
import { toModelInfo } from "../provider-register.js";

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
});

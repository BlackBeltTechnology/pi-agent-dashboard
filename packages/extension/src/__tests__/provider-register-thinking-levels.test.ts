/**
 * toModelInfo projects pi 0.72+'s per-model `thinkingLevelMap` into
 * `supportedThinkingLevels`. Keys whose value is non-null (string | true)
 * survive; null entries are dropped. Models without a map → undefined.
 *
 * See change: adopt-pi-071-072-073-features (B.1).
 */
import { describe, it, expect } from "vitest";
import { toModelInfo } from "../provider-register.js";

describe("toModelInfo — supportedThinkingLevels projection", () => {
  it("projects non-null thinkingLevelMap keys, drops null entries", () => {
    const info = toModelInfo({
      provider: "anthropic",
      id: "claude",
      thinkingLevelMap: { medium: "medium", high: "high", xhigh: null },
    });
    expect(info.supportedThinkingLevels).toEqual(["medium", "high"]);
  });

  it("leaves supportedThinkingLevels undefined when no map present", () => {
    const info = toModelInfo({ provider: "openai", id: "gpt" });
    expect(info.supportedThinkingLevels).toBeUndefined();
  });

  it("accepts `true` map values as supported", () => {
    const info = toModelInfo({
      provider: "p",
      id: "m",
      thinkingLevelMap: { low: true, medium: "medium", high: null },
    });
    expect(info.supportedThinkingLevels).toEqual(["low", "medium"]);
  });
});

import { describe, it, expect } from "vitest";
import {
  mergeDisplayPrefs,
  DISPLAY_PRESETS,
  toolCallPrefKey,
  type DisplayPrefs,
} from "../display-prefs.js";

const global: DisplayPrefs = DISPLAY_PRESETS.standard;

describe("mergeDisplayPrefs", () => {
  it("returns a defensive copy of global when override is undefined", () => {
    const merged = mergeDisplayPrefs(global, undefined);
    expect(merged).toEqual(global);
    expect(merged).not.toBe(global);
    expect(merged.toolCalls).not.toBe(global.toolCalls);
  });

  it("returns a defensive copy of global when override is empty", () => {
    const merged = mergeDisplayPrefs(global, {});
    expect(merged).toEqual(global);
  });

  it("applies sparse top-level override", () => {
    const merged = mergeDisplayPrefs(global, { reasoning: true });
    expect(merged.reasoning).toBe(true);
    expect(merged.tokenStatsBar).toBe(global.tokenStatsBar);
    expect(merged.toolResults).toBe(global.toolResults);
  });

  it("deep-merges toolCalls", () => {
    const merged = mergeDisplayPrefs(global, { toolCalls: { bash: false } });
    expect(merged.toolCalls.bash).toBe(false);
    expect(merged.toolCalls.read).toBe(global.toolCalls.read);
    expect(merged.toolCalls.edit).toBe(global.toolCalls.edit);
    expect(merged.toolCalls.agent).toBe(global.toolCalls.agent);
    expect(merged.toolCalls.generic).toBe(global.toolCalls.generic);
  });

  it("treats undefined fields as inherit-from-global, not false", () => {
    // explicit `false` overrides; missing key inherits
    const merged = mergeDisplayPrefs(
      { ...global, reasoning: true },
      { reasoning: false },
    );
    expect(merged.reasoning).toBe(false);
  });
});

describe("toolCallPrefKey", () => {
  it.each([
    ["read", "read"],
    ["bash", "bash"],
    ["edit", "edit"],
    ["write", "edit"],
    ["Agent", "agent"],
    ["foo_tool", "generic"],
  ])("maps %s → %s", (input, expected) => {
    expect(toolCallPrefKey(input)).toBe(expected);
  });

  it("returns null for ask_user (non-hidable)", () => {
    expect(toolCallPrefKey("ask_user")).toBeNull();
  });
});

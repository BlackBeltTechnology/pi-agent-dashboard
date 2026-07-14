import { describe, expect, it } from "vitest";
import {
  DISPLAY_PRESETS,
  type DisplayPrefs,
  mergeDisplayPrefs,
  toolCallPrefKey,
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

  it("defaults reasoningAutoCollapseMs to 30000 in all presets", () => {
    expect(DISPLAY_PRESETS.simple.reasoningAutoCollapseMs).toBe(30000);
    expect(DISPLAY_PRESETS.standard.reasoningAutoCollapseMs).toBe(30000);
    expect(DISPLAY_PRESETS.everything.reasoningAutoCollapseMs).toBe(30000);
  });

  it("applies reasoningAutoCollapseMs override precedence", () => {
    const merged = mergeDisplayPrefs(global, { reasoningAutoCollapseMs: 5000 });
    expect(merged.reasoningAutoCollapseMs).toBe(5000);
  });

  it("preserves an explicit 0 override (not coerced to global default)", () => {
    const merged = mergeDisplayPrefs(global, { reasoningAutoCollapseMs: 0 });
    expect(merged.reasoningAutoCollapseMs).toBe(0);
  });

  it("defaults keepReasoningOpenUntilTurnEnds to false in all presets", () => {
    expect(DISPLAY_PRESETS.simple.keepReasoningOpenUntilTurnEnds).toBe(false);
    expect(DISPLAY_PRESETS.standard.keepReasoningOpenUntilTurnEnds).toBe(false);
    expect(DISPLAY_PRESETS.everything.keepReasoningOpenUntilTurnEnds).toBe(false);
  });

  it("applies keepReasoningOpenUntilTurnEnds override precedence", () => {
    const merged = mergeDisplayPrefs(global, { keepReasoningOpenUntilTurnEnds: true });
    expect(merged.keepReasoningOpenUntilTurnEnds).toBe(true);
  });

  it("defaults toolGroupDefaultCollapsed to false in all presets", () => {
    expect(DISPLAY_PRESETS.simple.toolGroupDefaultCollapsed).toBe(false);
    expect(DISPLAY_PRESETS.standard.toolGroupDefaultCollapsed).toBe(false);
    expect(DISPLAY_PRESETS.everything.toolGroupDefaultCollapsed).toBe(false);
  });

  it("applies toolGroupDefaultCollapsed override precedence", () => {
    expect(mergeDisplayPrefs(global, { toolGroupDefaultCollapsed: true }).toolGroupDefaultCollapsed).toBe(true);
    // missing key inherits the global value
    expect(
      mergeDisplayPrefs({ ...global, toolGroupDefaultCollapsed: true }, {}).toolGroupDefaultCollapsed,
    ).toBe(true);
  });

  it("defaults changeSummaryTable off in simple, on in standard/everything", () => {
    expect(DISPLAY_PRESETS.simple.changeSummaryTable).toBe(false);
    expect(DISPLAY_PRESETS.standard.changeSummaryTable).toBe(true);
    expect(DISPLAY_PRESETS.everything.changeSummaryTable).toBe(true);
  });

  it("applies changeSummaryTable override precedence (off beats global on)", () => {
    expect(mergeDisplayPrefs(global, { changeSummaryTable: false }).changeSummaryTable).toBe(false);
    // missing key inherits the global value
    expect(mergeDisplayPrefs(global, {}).changeSummaryTable).toBe(true);
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

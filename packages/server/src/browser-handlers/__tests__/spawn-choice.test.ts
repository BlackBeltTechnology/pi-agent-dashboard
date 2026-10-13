/**
 * Validator for browser-supplied model / thinking choices.
 * test-plan: E2, E3, E4, E5. See change: redesign-directory-home-split.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveResumeChoice, validateSpawnChoice } from "../spawn-choice.js";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

describe("validateSpawnChoice", () => {
  it("E2: multi-segment provider/id is accepted unchanged", () => {
    expect(validateSpawnChoice({ model: "openrouter/meta-llama/llama-4" })).toEqual({
      model: "openrouter/meta-llama/llama-4",
    });
  });

  it("E3: invalid models are dropped with a warning", () => {
    for (const bad of ["x; rm -rf /", "--help/x", "a/b/--x", "sonnet", "a/", "/b", "a//b", `a/${"x".repeat(199)}`]) {
      warn.mockClear();
      expect(validateSpawnChoice({ model: bad }), bad).toEqual({});
      expect(warn, bad).toHaveBeenCalled();
    }
  });

  it("E3: 200 chars accepted, 201 dropped", () => {
    const ok = `a/${"x".repeat(198)}`;
    expect(ok).toHaveLength(200);
    expect(validateSpawnChoice({ model: ok })).toEqual({ model: ok });
    expect(validateSpawnChoice({ model: `${ok}x` })).toEqual({});
  });

  it("E4: the seven thinking levels pass, others are dropped", () => {
    for (const lvl of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
      expect(validateSpawnChoice({ thinkingLevel: lvl })).toEqual({ thinking: lvl });
    }
    for (const bad of ["turbo", "", "HIGH"]) expect(validateSpawnChoice({ thinkingLevel: bad }), bad).toEqual({});
  });

  it("E5: suffix decision table", () => {
    expect(validateSpawnChoice({ model: "m/x:high" })).toEqual({ model: "m/x", thinking: "high" });
    expect(validateSpawnChoice({ model: "m/x:high", thinkingLevel: "low" })).toEqual({ model: "m/x:high", thinking: "low" });
    expect(validateSpawnChoice({ model: "m/x:high", thinkingLevel: "bogus" })).toEqual({ model: "m/x:high" });
    expect(validateSpawnChoice({ model: "m/x:free" })).toEqual({ model: "m/x:free" });
  });

  it("a non-string model is dropped", () => {
    expect(validateSpawnChoice({ model: 42 })).toEqual({});
  });
});

describe("resolveResumeChoice", () => {
  it("drops everything for a fork", () => {
    expect(resolveResumeChoice({ model: "a/b", thinkingLevel: "low" }, "fork", { thinkingLevel: "high" })).toEqual({});
  });
  it("model-only pick fills the session thinking level", () => {
    expect(resolveResumeChoice({ model: "a/b" }, "continue", { thinkingLevel: "high" })).toEqual({ model: "a/b", thinking: "high" });
  });
  it("thinking-only pick adds no model", () => {
    expect(resolveResumeChoice({ thinkingLevel: "low" }, "continue", { thinkingLevel: "high" })).toEqual({ thinking: "low" });
  });
  it("no pick yields nothing", () => {
    expect(resolveResumeChoice({}, "continue", { thinkingLevel: "high" })).toEqual({});
  });
});

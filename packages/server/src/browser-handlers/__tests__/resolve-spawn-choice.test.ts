/**
 * resolveSpawnChoice — the one spawn-time choice resolver.
 * test-plan: E1–E9. See change: add-spawn-model-choice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSpawnChoice } from "../spawn-choice.js";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

const planning = () => ({ roles: { planning: "anthropic/claude-opus-5-5:high" } });

describe("resolveSpawnChoice", () => {
  it("E1: @role resolves to concrete model + role level", () => {
    expect(resolveSpawnChoice({ model: "@planning" }, { readRoles: planning })).toEqual({
      choice: { model: "anthropic/claude-opus-5-5", thinking: "high" },
      warnings: [],
    });
  });

  it("E2: explicit thinkingLevel beats the role level", () => {
    expect(resolveSpawnChoice({ model: "@planning", thinkingLevel: "low" }, { readRoles: planning })).toEqual({
      choice: { model: "anthropic/claude-opus-5-5", thinking: "low" },
      warnings: [],
    });
  });

  it("E3: ref suffix beats the role level", () => {
    expect(resolveSpawnChoice({ model: "@planning:medium" }, { readRoles: planning }).choice).toEqual({
      model: "anthropic/claude-opus-5-5",
      thinking: "medium",
    });
  });

  it("E4: literal ref keeps today's rule (explicit field disables suffix split)", () => {
    const readRoles = vi.fn(planning);
    expect(resolveSpawnChoice({ model: "anthropic/x:high", thinkingLevel: "low" }, { readRoles })).toEqual({
      choice: { model: "anthropic/x:high", thinking: "low" },
      warnings: [],
    });
    expect(readRoles).not.toHaveBeenCalled();
  });

  it("E5: roles file read only for @ refs", () => {
    const readRoles = vi.fn(() => ({ roles: { fast: "openai/gpt-6-mini" } }));
    resolveSpawnChoice({ model: "openai/gpt-6" }, { readRoles });
    expect(readRoles).toHaveBeenCalledTimes(0);
    resolveSpawnChoice({ model: "@fast" }, { readRoles });
    expect(readRoles).toHaveBeenCalledTimes(1);
  });

  it("E6: thinking-only pairs with the default model when one exists", () => {
    expect(resolveSpawnChoice({ thinkingLevel: "high" }, { defaultModel: "anthropic/claude-sonnet-5-5" }).choice).toEqual({
      model: "anthropic/claude-sonnet-5-5",
      thinking: "high",
    });
    expect(resolveSpawnChoice({ thinkingLevel: "high" }, {}).choice).toEqual({ thinking: "high" });
  });

  it("E7: unresolvable role → empty choice + warning naming the role", () => {
    const r = resolveSpawnChoice({ model: "@ghost" }, { readRoles: () => ({ roles: {} }) });
    expect(r.choice).toEqual({});
    expect(r.warnings.join(" ")).toContain("ghost");
  });

  it("E8: ACP agent warns only when a choice was given", () => {
    const withModel = resolveSpawnChoice({ agent: "qmt", model: "openai/gpt-6" });
    expect(withModel.choice).toEqual({});
    expect(withModel.warnings).toHaveLength(1);
    const bare = resolveSpawnChoice({ agent: "qmt" });
    expect(bare).toEqual({ choice: {}, warnings: [] });
  });

  it("E9: role assigned an invalid ref → model dropped + warning", () => {
    const r = resolveSpawnChoice({ model: "@bad" }, { readRoles: () => ({ roles: { bad: "--help/x" } }) });
    expect(r.choice.model).toBeUndefined();
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("empty strings count as absent", () => {
    expect(resolveSpawnChoice({ model: "", thinkingLevel: "" })).toEqual({ choice: {}, warnings: [] });
  });

  it("invalid literal model and bad level are reported", () => {
    const r = resolveSpawnChoice({ model: "sonnet", thinkingLevel: "turbo" });
    expect(r.choice).toEqual({});
    expect(r.warnings).toHaveLength(2);
  });

  it("readRoles throwing is total", () => {
    const r = resolveSpawnChoice({ model: "@fast" }, { readRoles: () => { throw new Error("boom"); } });
    expect(r.choice).toEqual({});
    expect(r.warnings.length).toBe(1);
  });
});

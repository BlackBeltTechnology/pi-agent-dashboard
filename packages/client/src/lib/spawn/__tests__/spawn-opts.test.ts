/**
 * Sibling / Initialize option builders shared by SessionList and App (the App
 * keyboard sibling shortcut calls `handleSpawnSession(cwd, undefined,
 * siblingSpawnOpts(target))`).
 * test-plan: E44. See change: add-spawn-model-choice.
 * Exemplar: hooks/__tests__/useSessionActions.spawn-choice.test.tsx.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { setSpawnDefaults } from "../spawn-choice-memory.js";
import { initializeSpawnOpts, siblingSpawnOpts } from "../spawn-opts.js";

afterEach(() => {
  vi.unstubAllGlobals();
  setSpawnDefaults({});
});

describe("siblingSpawnOpts (E44)", () => {
  it("pi source carries model + thinking; ACP source the agent; empty → undefined", () => {
    expect(siblingSpawnOpts({ model: "a/b", thinkingLevel: "high" })).toEqual({ model: "a/b", thinkingLevel: "high" });
    expect(siblingSpawnOpts({ model: "", thinkingLevel: "" })).toBeUndefined();
    expect(siblingSpawnOpts({ driver: "acp", acpAgentId: "qmt", model: "a/b" })).toEqual({ agent: "qmt" });
    expect(siblingSpawnOpts({ thinkingLevel: "low" })).toEqual({ thinkingLevel: "low" });
  });
});

describe("initializeSpawnOpts", () => {
  it("carries the initial prompt plus the effective choice", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    Object.defineProperty(window, "localStorage", { value: globalThis.localStorage, configurable: true });
    setSpawnDefaults({ defaultModel: "a/d" });
    expect(initializeSpawnOpts("/p", "/skill:project-init")).toEqual({ initialPrompt: "/skill:project-init", model: "a/d" });
  });
});

/**
 * Per-folder spawn-choice memory: totality + per-field fallback.
 * test-plan: E36, E37. See change: add-spawn-model-choice.
 * Exemplar: hooks/__tests__/useSessionActions.spawn-choice.test.tsx (localStorage stubbing).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRememberedSpawnField,
  getEffectiveSpawnChoice,
  getRememberedSpawnChoice,
  setRememberedSpawnChoice,
  setSpawnDefaults,
} from "../spawn-choice-memory.js";

function stubStorage(impl: Partial<Storage>): void {
  vi.stubGlobal("localStorage", impl);
  Object.defineProperty(window, "localStorage", { value: globalThis.localStorage, configurable: true });
}
afterEach(() => {
  vi.unstubAllGlobals();
  setSpawnDefaults({});
});

describe("spawn-choice memory", () => {
  it("E36: unavailable storage → defaults, never throws", () => {
    const boom = () => {
      throw new Error("denied");
    };
    stubStorage({ getItem: boom, setItem: boom, removeItem: boom });
    const defaults = { model: "m/x", thinkingLevel: "high" };
    expect(getEffectiveSpawnChoice("/a", defaults)).toEqual(defaults);
    expect(() => setRememberedSpawnChoice("/a", { model: "@fast" })).not.toThrow();
    expect(() => clearRememberedSpawnField("/a", "model")).not.toThrow();
  });

  it("E37: per-field fallback to the Settings defaults", () => {
    const store: Record<string, string> = {};
    stubStorage({
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
    });
    setRememberedSpawnChoice("/a", { thinkingLevel: "low" });
    expect(getEffectiveSpawnChoice("/a", { model: "m/x", thinkingLevel: "high" })).toEqual({ model: "m/x", thinkingLevel: "low" });
    setSpawnDefaults({ defaultModel: "m/y" });
    expect(getEffectiveSpawnChoice("/a")).toEqual({ model: "m/y", thinkingLevel: "low" });
    clearRememberedSpawnField("/a", "thinkingLevel");
    expect(getRememberedSpawnChoice("/a")).toEqual({});
    expect(store).toEqual({});
  });

  it("garbled stored JSON reads as empty", () => {
    stubStorage({ getItem: () => "{nope", setItem: () => {}, removeItem: () => {} });
    expect(getRememberedSpawnChoice("/a")).toEqual({});
  });
});

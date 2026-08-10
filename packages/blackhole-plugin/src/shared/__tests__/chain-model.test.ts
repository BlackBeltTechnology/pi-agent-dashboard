/**
 * L1 — chain algebra (test-plan E18-E21, and the `contextWindow` absence rule
 * of E20). Pure functions; the rendered behaviour is covered by the L3 specs.
 *
 * See change: add-blackhole-plugin.
 */
import { describe, expect, it } from "vitest";
import {
  canRemove,
  moveEntry,
  normalizeModel,
  readChain,
  removeEntry,
  writeChain,
} from "../chain-model.js";

const A = { provider: "openrouter", id: "A" };
const B = { provider: "ollama", id: "B" };
const C = { provider: "cerebras", id: "C" };

describe("chain order maps to array order (E18)", () => {
  it("reads primary then fallbacks as one ordered list", () => {
    const chain = readChain(
      { observerModel: A, observerFallbackModels: [B, C] },
      "observerModel",
      "observerFallbackModels",
    );
    expect(chain).toEqual([A, B, C]);
  });

  it("serialises the list back to observerModel + observerFallbackModels in order", () => {
    expect(writeChain([A, B, C])).toEqual({ primary: A, fallbacks: [B, C] });
  });

  it("omits the fallback array for a single-entry chain", () => {
    expect(writeChain([A])).toEqual({ primary: A, fallbacks: undefined });
  });

  it("omits both keys for an empty chain", () => {
    expect(writeChain([])).toEqual({ primary: undefined, fallbacks: undefined });
  });

  it("preserves RESOLUTION ORDER when the primary key is absent", () => {
    // blackhole's own `parseModel(raw.observerModel)` yields undefined for an
    // absent primary, so resolution starts at the fallback list. Reading that
    // shape into one ranked list and writing it back re-keys the entries but
    // leaves the ORDER models are tried in identical — which is the behaviour
    // the config expresses. The file text changes; resolution does not.
    const before = { observerFallbackModels: [A, B, C] };
    const chain = readChain(before, "observerModel", "observerFallbackModels");
    expect(chain).toEqual([A, B, C]);

    const { primary, fallbacks } = writeChain(chain);
    expect([primary, ...(fallbacks ?? [])]).toEqual([A, B, C]);
  });

  it("tolerates an absent primary or a non-array fallback field", () => {
    expect(readChain({}, "observerModel", "observerFallbackModels")).toEqual([]);
    expect(
      readChain({ observerFallbackModels: "nope" }, "observerModel", "observerFallbackModels"),
    ).toEqual([]);
  });
});

describe("promotion (E19)", () => {
  it("moving the first fallback above the primary rewrites both keys", () => {
    const moved = moveEntry([A, B, C], 1, -1);
    expect(moved).toEqual([B, A, C]);
    expect(writeChain(moved)).toEqual({ primary: B, fallbacks: [A, C] });
  });

  it("moves an entry down", () => {
    expect(moveEntry([A, B, C], 0, 1)).toEqual([B, A, C]);
  });

  it("is a no-op past either boundary", () => {
    expect(moveEntry([A, B], 0, -1)).toEqual([A, B]);
    expect(moveEntry([A, B], 1, 1)).toEqual([A, B]);
    expect(moveEntry([A, B], 5, -1)).toEqual([A, B]);
  });
});

describe("a worker chain cannot be emptied (E21)", () => {
  it("offers no remove on a single-entry chain", () => {
    expect(canRemove([A])).toBe(false);
    expect(canRemove([A, B])).toBe(true);
  });

  it("refuses to remove the last entry", () => {
    expect(removeEntry([A], 0)).toEqual([A]);
  });

  it("removes a non-final entry", () => {
    expect(removeEntry([A, B, C], 1)).toEqual([A, C]);
  });
});

describe("per-model field normalisation (E20)", () => {
  it("writes a cleared contextWindow as ABSENT, never 0 or null", () => {
    const out = normalizeModel({ provider: "p", id: "m", contextWindow: "" });
    expect(Object.hasOwn(out, "contextWindow")).toBe(false);
    expect(JSON.stringify(out)).not.toContain("contextWindow");
  });

  it("keeps a set contextWindow", () => {
    expect(normalizeModel({ provider: "p", id: "m", contextWindow: "128000" }).contextWindow).toBe(
      128_000,
    );
  });

  it("keeps cooldownHours 0 — 0 means disabled, not cleared", () => {
    expect(normalizeModel({ provider: "p", id: "m", cooldownHours: 0 }).cooldownHours).toBe(0);
  });

  it("drops a cleared cooldownHours", () => {
    expect(Object.hasOwn(normalizeModel({ provider: "p", id: "m", cooldownHours: "" }), "cooldownHours")).toBe(
      false,
    );
  });

  it("trims provider and id, and drops an empty thinking level", () => {
    const out = normalizeModel({ provider: " openrouter ", id: " m ", thinking: "" });
    expect(out.provider).toBe("openrouter");
    expect(out.id).toBe("m");
    expect(Object.hasOwn(out, "thinking")).toBe(false);
  });

  it("preserves annotation keys inside a model entry", () => {
    const out = normalizeModel({ _comment: "kept", provider: "p", id: "m" });
    expect((out as unknown as Record<string, unknown>)._comment).toBe("kept");
  });
});

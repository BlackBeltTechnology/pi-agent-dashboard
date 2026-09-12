/**
 * L1 — chain algebra (test-plan E18-E21, and the `contextWindow` absence rule
 * of E20). Pure functions; the rendered behaviour is covered by the L3 specs.
 *
 * See change: add-blackhole-plugin.
 */
import { describe, expect, it } from "vitest";
import {
  appendEntry,
  canRemove,
  moveEntry,
  normalizeModel,
  readChain,
  recommendedDefaults,
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

describe("appendEntry (E1, E2)", () => {
  it("1.1 appends to an empty chain (E1)", () => {
    const entries: typeof A[] = [];
    const ref = { provider: "p", id: "m" };
    const result = appendEntry(entries, ref);
    expect(result).toEqual([ref]);
    expect(writeChain(result)).toEqual({ primary: ref, fallbacks: undefined });
    expect(entries).toEqual([]);
  });

  it("1.2 appends to [A] and [A,B,C] with D as last fallback (E2)", () => {
    const D = { provider: "deepseek", id: "D" };
    const chain1 = [A];
    const res1 = appendEntry(chain1, D);
    expect(res1).toEqual([A, D]);
    expect(writeChain(res1)).toEqual({ primary: A, fallbacks: [D] });
    expect(chain1).toEqual([A]);

    const chain3 = [A, B, C];
    const res3 = appendEntry(chain3, D);
    expect(res3).toEqual([A, B, C, D]);
    expect(writeChain(res3)).toEqual({ primary: A, fallbacks: [B, C, D] });
    expect(chain3).toEqual([A, B, C]);
  });
});

describe("recommendedDefaults (E3-E7, P1)", () => {
  it("1.3 rank buckets: flash > haiku > mini, others dropped (E3)", () => {
    const registry = [
      { provider: "p-mini", id: "x-mini" },
      { provider: "p-haiku", id: "y-haiku" },
      { provider: "p-flash", id: "z-flash" },
      { provider: "p-other", id: "w-other" },
    ];
    const { chain, found } = recommendedDefaults(registry);
    expect(found).toBe(true);
    expect(chain.map((m) => m.id)).toEqual(["z-flash", "y-haiku", "x-mini"]);
    expect(chain.map((m) => m.provider)).toEqual(["p-flash", "p-haiku", "p-mini"]);
    expect(chain.some((m) => m.id === "w-other")).toBe(false);
  });

  it("1.4 preserves registry order within the same rank (E4)", () => {
    const registry = [
      { provider: "p1", id: "a-flash" },
      { provider: "p2", id: "b-flash" },
      { provider: "p3", id: "c-flash" },
    ];
    const { chain, found } = recommendedDefaults(registry);
    expect(found).toBe(true);
    expect(chain.map((m) => m.id)).toEqual(["a-flash", "b-flash", "c-flash"]);
  });

  it("1.5 cap of 3 and deduplication by provider/id (E5)", () => {
    const registry = [
      { provider: "p1", id: "m1-flash" },
      { provider: "p2", id: "m2-flash" },
      { provider: "p3", id: "m3-flash" },
      { provider: "p4", id: "m4-flash" },
      { provider: "p1", id: "m1-flash" }, // duplicate of first
    ];
    const { chain, found } = recommendedDefaults(registry);
    expect(found).toBe(true);
    expect(chain.length).toBe(3);
    const seen = new Set<string>();
    for (const entry of chain) {
      const key = `${entry.provider}/${entry.id}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(entry).toEqual({
        provider: entry.provider,
        id: entry.id,
        cooldownHours: 1,
      });
      expect(Object.keys(entry).sort()).toEqual(["cooldownHours", "id", "provider"]);
    }
  });

  it("1.6 distinct-provider preference before filling by rank (E6)", () => {
    const registry = [
      { provider: "g", id: "1-flash" },
      { provider: "g", id: "2-flash" },
      { provider: "g", id: "3-flash" },
      { provider: "d", id: "4-mini" },
    ];
    const { chain, found } = recommendedDefaults(registry);
    expect(found).toBe(true);
    expect(chain.map((m) => `${m.provider}/${m.id}`)).toEqual([
      "g/1-flash",
      "d/4-mini",
      "g/2-flash",
    ]);
  });

  it("1.7 returns found:false and empty chain on no candidate; input not mutated (E7)", () => {
    const empty: { provider: string; id: string }[] = [];
    const r1 = recommendedDefaults(empty);
    expect(r1).toEqual({ chain: [], found: false });
    expect(empty).toEqual([]);

    const noMatches = [{ provider: "a", id: "b-pro" }];
    const r2 = recommendedDefaults(noMatches);
    expect(r2).toEqual({ chain: [], found: false });
    expect(noMatches).toEqual([{ provider: "a", id: "b-pro" }]);
  });

  it("1.8 micro-benchmark: 2000-row synthetic registry completes under 50 ms (P1)", () => {
    const largeRegistry: { provider: string; id: string }[] = [];
    for (let i = 0; i < 2000; i++) {
      if (i % 5 === 0) {
        largeRegistry.push({ provider: `prov-${i % 20}`, id: `model-${i}-flash` });
      } else {
        largeRegistry.push({ provider: `prov-${i % 20}`, id: `model-${i}-pro` });
      }
    }
    const start = performance.now();
    const { chain, found } = recommendedDefaults(largeRegistry);
    const elapsed = performance.now() - start;
    expect(found).toBe(true);
    expect(chain.length).toBe(3);
    expect(elapsed).toBeLessThan(50);
  });
});

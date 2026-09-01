/**
 * The CROSS-PLUGIN work-source registration seam (decision D-WSREG).
 *
 * The registry could previously only be populated from this plugin's own config
 * (folder-backed sources), so no other plugin could supply a source at all.
 * These lock the seam that fixes it:
 *   - a published `{ id, source }` contribution resolves through the registry
 *     (schema id validation included) and drives a real fan-out;
 *   - collection is LAZY, so a source published AFTER the provider was added is
 *     still found (plugin load order is irrelevant);
 *   - locally registered ids win a collision;
 *   - one malformed contribution never costs the others their sources.
 *
 * See change: relocate-fanout-to-work-source.
 */
import { describe, expect, it } from "vitest";
import { collectWorkSourceContributions, WORK_SOURCE_CONTRIBUTION_PREFIX } from "../server/work-source-contributions.js";
import { WorkSourceRegistry } from "../server/work-source-registry.js";
import type { AnyWorkSource, LeasedHandle, WorkSource } from "../shared/work-source.js";

/** Narrow a resolved source to its synchronous shape (these fakes vend sync). */
const sync = (s: AnyWorkSource | undefined) => s as WorkSource<string> | undefined;

function fakeSource(tag: string): AnyWorkSource<string> {
  return {
    next: (): LeasedHandle<string>[] => [{ item: tag, leaseToken: `${tag}-1`, idempotencyKey: tag }],
    ack: () => {},
    nack: () => {},
  };
}

describe("work-source contribution collection", () => {
  it("accepts a single descriptor and an array of them", () => {
    const collected = collectWorkSourceContributions([
      { key: `${WORK_SOURCE_CONTRIBUTION_PREFIX}one`, value: { id: "a", source: fakeSource("a") } },
      {
        key: `${WORK_SOURCE_CONTRIBUTION_PREFIX}many`,
        value: [
          { id: "b", source: fakeSource("b") },
          { id: "c", source: fakeSource("c") },
        ],
      },
    ]);
    expect(collected.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("drops malformed entries with a warning and keeps the valid ones", () => {
    const warnings: string[] = [];
    const collected = collectWorkSourceContributions(
      [
        { key: "automation.worksource.bad1", value: { id: "", source: fakeSource("x") } },
        { key: "automation.worksource.bad2", value: { id: "y", source: { ack: () => {} } } },
        { key: "automation.worksource.bad3", value: null },
        { key: "automation.worksource.ok", value: { id: "z", source: fakeSource("z") } },
        { key: "automation.worksource.dup", value: { id: "z", source: fakeSource("z2") } },
      ],
      { warn: (m) => warnings.push(m) },
    );
    expect(collected.map((c) => c.id)).toEqual(["z"]);
    expect(warnings).toHaveLength(4);
    expect(warnings.some((w) => w.includes("duplicate id"))).toBe(true);
  });
});

describe("registry provider seam", () => {
  it("resolves a provider-supplied source and reports its id", () => {
    const reg = new WorkSourceRegistry();
    const published: Array<{ key: string; value: unknown }> = [];
    reg.addProvider({
      ids: () => collectWorkSourceContributions(published).map((c) => c.id),
      get: (id) => collectWorkSourceContributions(published).find((c) => c.id === id)?.source,
    });

    // Nothing published yet — the provider is inert, not an error.
    expect(reg.has("late")).toBe(false);
    expect([...reg.ids()]).toEqual([]);

    // Published AFTER the provider was added: collection is lazy, so it lands.
    published.push({ key: "automation.worksource.late", value: { id: "late", source: fakeSource("L") } });
    expect(reg.has("late")).toBe(true);
    expect([...reg.ids()]).toEqual(["late"]);
    expect(reg.get("late")?.next(1)).toEqual([{ item: "L", leaseToken: "L-1", idempotencyKey: "L" }]);
  });

  it("a locally registered id wins over a provider's", () => {
    const reg = new WorkSourceRegistry();
    reg.register("dup", fakeSource("own"));
    reg.addProvider({ ids: () => ["dup"], get: () => fakeSource("theirs") });
    expect(sync(reg.get("dup"))?.next(1)[0]?.item).toBe("own");
    expect([...reg.ids()]).toEqual(["dup"]);
  });

  it("a throwing provider never breaks resolution of other sources", () => {
    const reg = new WorkSourceRegistry();
    reg.addProvider({
      ids: () => {
        throw new Error("provider boom");
      },
      get: () => {
        throw new Error("provider boom");
      },
    });
    reg.addProvider({ ids: () => ["good"], get: (id) => (id === "good" ? fakeSource("G") : undefined) });

    expect([...reg.ids()]).toEqual(["good"]);
    expect(sync(reg.get("good"))?.next(1)[0]?.item).toBe("G");
    expect(reg.get("missing")).toBeUndefined();
  });
});

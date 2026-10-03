/**
 * `adaptPiAi` end-to-end behaviour across both generations.
 *
 * Covers test-plan #E2 (factory adapted), #E9 (legacy rejected — the legacy
 * passthrough #E1 is retired by update-pi-core-1-0-adopt-apis),
 * #E3/#E4 (rejections), #E5 (getProviders projection + non-trivial COUNT),
 * #E10 (built-in dedup precedence unperturbed) and #P2 (first-use cost).
 *
 * The factory-branch tests run against the REAL ≥0.85 runtime and self-skip
 * while the pin is still `^0.75.5`.
 *
 * See change: adopt-piai-factory-api-registry.
 */
import { sep } from "node:path";
import { describe, expect, it } from "vitest";
import { adaptPiAi } from "../index.js";
import { emptyStream, factoryFake, legacyFake, resolveFactoryPiAi } from "./fakes.js";

const LEGACY_PATH = ["", "fake", "pi-ai", "dist", "index.js"].join(sep);

describe("adaptPiAi — factory generation only (E9)", () => {
  // test-plan #E9 — legacy-only module → error naming unsupported legacy pi-ai.
  it("rejects a legacy-only module naming it an unsupported legacy pi-ai, probing nothing", async () => {
    const imported: string[] = [];
    const deps = {
      importPath: async (p: string) => {
        imported.push(p);
        return {};
      },
      exists: () => true,
    };
    await expect(adaptPiAi(legacyFake({ streamSimple: () => emptyStream() }), LEGACY_PATH, deps)).rejects.toThrow(
      /unsupported legacy pi-ai/,
    );
    await expect(adaptPiAi(legacyFake(), undefined, deps)).rejects.toThrow(/1\.0\.0/);
    expect(imported).toEqual([]);
  });

  // test-plan #E9 — partial factory → error naming the missing members.
  it("rejects a partial factory module naming the missing member", async () => {
    await expect(adaptPiAi({ createModels: () => ({}) }, LEGACY_PATH)).rejects.toThrow(/createProvider/);
  });
});

describe("adaptPiAi — rejections", () => {
  // test-plan #E3
  it("rejects a partial module naming the missing member", async () => {
    const partial = legacyFake();
    delete partial.streamSimple;
    await expect(adaptPiAi(partial, LEGACY_PATH)).rejects.toThrow(/streamSimple/);
  });

  // test-plan #E4
  it("rejects an empty module with a diagnosable reason", async () => {
    await expect(adaptPiAi({}, LEGACY_PATH)).rejects.toThrow(/neither the legacy global API/);
  });

  it("rejects a factory module with no resolved path", async () => {
    await expect(adaptPiAi(factoryFake())).rejects.toThrow(/requires a resolved module path/);
  });
});

describe("adaptPiAi — factory branch (real ≥0.85 runtime)", async () => {
  const real = await resolveFactoryPiAi();
  const when = real ? it : it.skip;

  if (!real) {
    it("skips: no pi-ai >= 0.85 resolvable (pin still on the legacy generation)", () => {
      expect(real).toBeNull();
    });
  }

  // test-plan #E2
  when("adapts the real module to a non-empty surface", async () => {
    const { generation, module } = await adaptPiAi(real!.module, real!.path);
    expect(generation).toBe("factory");
    expect(module.getProviders().length).toBeGreaterThan(0);
  });

  // test-plan #E5 — the silent-empty guard. `getProviders()` returns Provider
  // OBJECTS on >=0.85; feeding those into getModels() yields ZERO models with
  // NO error. A count assertion, not a non-empty-list assertion.
  when("projects getProviders() to id STRINGS and sums a non-trivial model count", async () => {
    const { module } = await adaptPiAi(real!.module, real!.path);
    const providers = module.getProviders();
    expect(providers.length).toBeGreaterThan(0);
    for (const p of providers) expect(typeof p).toBe("string");

    let total = 0;
    for (const p of providers) total += module.getModels(p).length;
    expect(total).toBeGreaterThan(1000);
  });

  // test-plan #E5 companion (task 1.5b)
  when("resolves the models the legacy catalogue was missing", async () => {
    const { module } = await adaptPiAi(real!.module, real!.path);
    expect(module.getModel("anthropic", "claude-opus-5")).toBeTruthy();
    expect(module.getModel("zai", "glm-5.3")).toBeTruthy();
    expect(module.getModel("deepseek", "deepseek-flash")).toBeTruthy();
  });

  // test-plan #E10 — the seam must not register anything into the built-in
  // collection, or InternalRegistry's dedup-keeps-first would source custom
  // entries in the BUILT-IN pass and discard the native capability projection.
  when("registerApiProvider does not perturb the built-in provider list", async () => {
    const { module } = await adaptPiAi(real!.module, real!.path);
    const before = module.getProviders().slice().sort();
    module.registerApiProvider({ id: "anthropic", name: "shadow" }, "test");
    module.registerBuiltInApiProviders();
    expect(module.getProviders().slice().sort()).toEqual(before);
  });

  // test-plan #P2 — first-use cost is bounded.
  when("adapts 5x cold with a p95 under 1500ms", async () => {
    const durations: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      await adaptPiAi(real!.module, real!.path);
      durations.push(performance.now() - start);
    }
    durations.sort((a, b) => a - b);
    // p95 of 5 samples is the slowest sample.
    expect(durations[durations.length - 1]).toBeLessThan(1500);
  });
});

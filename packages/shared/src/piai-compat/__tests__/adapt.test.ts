/**
 * `adaptPiAi` end-to-end behaviour across both generations.
 *
 * Covers test-plan #E1 (legacy passthrough), #E2 (factory adapted),
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

describe("adaptPiAi — legacy branch", () => {
  // test-plan #E1
  it("returns the input object identity and probes NO factory subpath", async () => {
    const mod = legacyFake({ streamSimple: () => emptyStream() });
    const imported: string[] = [];
    const result = await adaptPiAi(mod, LEGACY_PATH, {
      importPath: async (p) => {
        imported.push(p);
        return {};
      },
      exists: () => false,
    });

    expect(result.generation).toBe("legacy");
    expect(result.module).toBe(mod);
    // No providers/all.js, no api/*.lazy.js, no utils/transcript.js.
    expect(imported.filter((p) => /providers|api|transcript/.test(p))).toEqual([]);
  });

  // test-plan #X7 (the seam half) — the legacy branch must not normalize.
  it("does not wrap streamSimple, so the legacy context passes through unnormalized", async () => {
    const seen: any[] = [];
    const mod = legacyFake({
      streamSimple: (_m: any, ctx: any) => {
        seen.push(ctx);
        return emptyStream();
      },
    });
    const { module } = await adaptPiAi(mod, LEGACY_PATH, {
      importPath: async () => ({}),
      exists: () => false,
    });
    const context = { messages: [{ role: "user" }], systemPrompt: "SP", tools: [{ name: "t" }] };
    module.streamSimple({ provider: "p", id: "m", api: "anthropic-messages" }, context);

    expect(seen).toHaveLength(1);
    // Identity: not a normalized `{ messages }` projection.
    expect(seen[0]).toBe(context);
    expect(seen[0].systemPrompt).toBe("SP");
  });

  it("works without a resolved path, reporting OAuth unavailable", async () => {
    const mod = legacyFake();
    const result = await adaptPiAi(mod, undefined, { importPath: async () => ({}), exists: () => false });
    expect(result.module).toBe(mod);
    expect(result.oauth.isAvailable("anthropic")).toBe(false);
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

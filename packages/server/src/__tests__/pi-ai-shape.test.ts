/**
 * Precondition test: the compatibility SEAM's contract, across both pi-ai
 * generations.
 *
 * Before `adopt-piai-factory-api-registry` this asserted seven raw global
 * members plus six raw OAuth symbols on the resolved module. That assertion
 * is now WRONG as a precondition: a ≥0.85 runtime exports none of them, yet
 * the dashboard works. What actually has to hold is that `adaptPiAi` turns
 * WHATEVER is resolved into the surface the registry consumes — so that is
 * what is asserted here.
 *
 * - `it.skip` when pi-ai cannot be resolved (clean CI without ~/.pi-dashboard/).
 * - Set `MODEL_PROXY_REQUIRE_PI_AI=1` to force hard-fail (for release-cut runs).
 *
 * Run locally:
 *   MODEL_PROXY_REQUIRE_PI_AI=1 npm test -- pi-ai-shape
 *
 * See change: adopt-piai-factory-api-registry (task 2.5).
 */
import { adaptPiAi, type AdaptedPiAi } from "@blackbelt-technology/pi-dashboard-shared/piai-compat/index.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { beforeAll, describe, expect, it } from "vitest";

const REQUIRE = process.env.MODEL_PROXY_REQUIRE_PI_AI === "1";

let adapted: AdaptedPiAi | null = null;
let resolvedPath: string | null = null;
let resolveError: Error | null = null;

beforeAll(async () => {
  try {
    const result = await getDefaultRegistry().resolveModule<unknown>("pi-ai");
    resolvedPath = result.resolution.path ?? null;
    // The seam owns the oauth subpath load too, so this exercises the exact
    // construction path `registry-singleton` takes.
    adapted = await adaptPiAi(result.module, resolvedPath ?? undefined);
  } catch (err) {
    resolveError = err as Error;
    if (REQUIRE) {
      throw new Error(
        `MODEL_PROXY_REQUIRE_PI_AI=1 but the pi-ai seam could not be constructed: ${(err as Error).message}`,
      );
    }
  }
});

describe("pi-ai compatibility seam precondition", () => {
  it("adapts the resolved pi-ai or skips gracefully", () => {
    if (REQUIRE) {
      expect(adapted).not.toBeNull();
    } else if (!adapted) {
      console.log(`pi-ai not adaptable (${resolveError?.message}); skipping seam checks`);
    }
  });

  it("classifies the resolved runtime as a supported generation", () => {
    if (!adapted) return;
    expect(["legacy", "factory"]).toContain(adapted.generation);
  });

  // ── the surface InternalRegistry consumes ────────────────────────────────

  describe("adapted module surface", () => {
    const members = [
      "registerBuiltInApiProviders",
      "getModels",
      "getProviders",
      "getModel",
      "registerApiProvider",
      "unregisterApiProviders",
      "streamSimple",
    ] as const;

    for (const member of members) {
      it(`exposes ${member}`, () => {
        if (!adapted) return;
        expect(typeof (adapted.module as any)[member]).toBe("function");
      });
    }

    // The silent-empty guard, promoted to a precondition. `getProviders()`
    // returning `Provider` OBJECTS (as ≥0.85 does natively) yields ZERO models
    // from `getModels()` with no error — a 200 with a wrong catalogue, which
    // is the exact failure this change exists to fix.
    it("returns provider IDENTIFIERS, not provider objects", () => {
      if (!adapted) return;
      for (const p of adapted.module.getProviders()) expect(typeof p).toBe("string");
    });

    it("resolves a non-trivial number of built-in models", () => {
      if (!adapted) return;
      const providers = adapted.module.getProviders();
      expect(providers.length).toBeGreaterThan(0);
      let total = 0;
      for (const p of providers) total += adapted.module.getModels(p).length;
      expect(total).toBeGreaterThan(0);
    });
  });

  // ── the OAuth facade InternalAuthStorage consumes ────────────────────────

  describe("adapted oauth facade", () => {
    it("exposes the per-provider capability gate", () => {
      if (!adapted) return;
      expect(typeof adapted.oauth.isAvailable).toBe("function");
      expect(typeof adapted.oauth.getOAuthProvider).toBe("function");
      expect(typeof adapted.oauth.refreshOAuthToken).toBe("function");
    });

    it("answers isAvailable for every provider the dashboard maps, without throwing", () => {
      if (!adapted) return;
      for (const id of ["anthropic", "openai-codex", "github-copilot"]) {
        expect(typeof adapted.oauth.isAvailable(id)).toBe("boolean");
      }
    });

    // Partial degradation is a CONTRACT, not an accident: an unavailable
    // provider must be diagnosable rather than silently absent.
    it("supplies a reason for every unavailable provider", () => {
      if (!adapted) return;
      for (const id of ["anthropic", "openai-codex", "github-copilot"]) {
        if (!adapted.oauth.isAvailable(id)) {
          expect(adapted.oauth.unavailableReason?.(id)).toBeTruthy();
        }
      }
    });
  });
});

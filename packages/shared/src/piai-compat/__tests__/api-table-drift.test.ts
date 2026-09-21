/**
 * D4 table drift guard — test-plan #E8.
 *
 * `Api` is an OPEN union (`KnownApi | (string & {})`), so no compile-time
 * exhaustiveness check is possible. This test is the substitute: it diffs the
 * table against the `*.lazy.js` factories the RESOLVED runtime actually ships,
 * so an upstream addition fails here instead of falling through to a dispatch
 * error in production.
 *
 * `openrouter-images.lazy.js` is excluded EXPLICITLY, and the exclusion is
 * itself asserted — its factory returns `{ generateImages }`, an images api
 * with no `streamSimple`, and a naive "every factory must be mapped" diff
 * would false-fail on it.
 *
 * Self-skips while the pin is still on the legacy generation, which ships no
 * `dist/api/` at all.
 *
 * See change: adopt-piai-factory-api-registry.
 */
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { API_LAZY_TABLE, NON_TEXT_LAZY_FILES } from "../api-table.js";
import { derivePiAiSubpath, piAiDistDir } from "../subpath.js";
import { importAbs, resolveFactoryPiAi } from "./fakes.js";

describe("api → lazy-module table drift", async () => {
  const real = await resolveFactoryPiAi();
  const when = real ? it : it.skip;

  if (!real) {
    it("skips: no pi-ai >= 0.85 resolvable (the legacy generation ships no dist/api/)", () => {
      expect(real).toBeNull();
    });
  }

  when("maps every text-streaming *.lazy.js factory the runtime ships", () => {
    const apiDir = derivePiAiSubpath(real!.path, "api");
    const shipped = readdirSync(apiDir).filter((f) => f.endsWith(".lazy.js"));
    expect(shipped.length).toBeGreaterThan(0);

    const mapped = new Set(Object.values(API_LAZY_TABLE).map((e) => e.module.replace(/^api\//, "")));
    const unmapped = shipped.filter((f) => !mapped.has(f) && !NON_TEXT_LAZY_FILES.has(f));
    expect(unmapped).toEqual([]);
  });

  when("does not false-fail on the images factory, which has no streamSimple", async () => {
    const path = derivePiAiSubpath(real!.path, "api/openrouter-images.lazy.js");
    const mod = await importAbs(path);
    const api = mod.openrouterImagesApi();
    expect(typeof api.streamSimple).toBe("undefined");
    expect(NON_TEXT_LAZY_FILES.has("openrouter-images.lazy.js")).toBe(true);
  });

  when("every table entry resolves to a factory yielding a streamSimple", async () => {
    for (const [api, entry] of Object.entries(API_LAZY_TABLE)) {
      const mod = await importAbs(derivePiAiSubpath(real!.path, entry.module));
      const factory = mod[entry.exportName];
      expect(factory, `${api} → ${entry.exportName}`).toBeTypeOf("function");
      expect(typeof factory().streamSimple, `${api}.streamSimple`).toBe("function");
    }
  });

  when("every api the built-in catalogue actually uses has a table entry", async () => {
    const all = await importAbs(`${piAiDistDir(real!.path)}/providers/all.js`);
    const models = all.builtinModels();
    const apis = new Set<string>();
    for (const provider of models.getProviders()) {
      for (const model of models.getModels(provider.id ?? provider)) apis.add(model.api);
    }
    expect(apis.size).toBeGreaterThan(0);
    expect([...apis].filter((a) => !(a in API_LAZY_TABLE))).toEqual([]);
  });
});

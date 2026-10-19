/**
 * `buildRuntimeCatalogue` — the fallback `ProviderInfo[]` derived from the
 * server runtime. Test-plan #E3 #E4 #X2.
 * See change: fix-provider-catalogue-first-run (D1).
 */
import { describe, expect, it } from "vitest";
import {
  type AuthCheckLike,
  buildRuntimeCatalogue,
  type RuntimeCatalogueSource,
} from "../auth/runtime-provider-catalogue.js";

function source(
  ids: string[],
  check: (id: string) => Promise<AuthCheckLike | undefined>,
): RuntimeCatalogueSource {
  return {
    getProviders: () => ids.map((id) => ({ id, name: id.toUpperCase() })),
    checkAuth: check,
  };
}

const opts = (over: Partial<Parameters<typeof buildRuntimeCatalogue>[1]> = {}) => ({
  customIds: [] as string[],
  authData: {},
  env: {},
  ...over,
});

describe("buildRuntimeCatalogue", () => {
  it("E3: maps checkAuth results to configured/source/authLabel", async () => {
    const results: Record<string, AuthCheckLike | undefined> = {
      a: undefined,
      b: { type: "oauth", source: "OAuth" },
      c: { type: "api_key", source: "stored credential" },
      d: { type: "api_key", source: "DEEPSEEK_API_KEY" },
    };
    const out = await buildRuntimeCatalogue(
      source(["a", "b", "c", "d"], async (id) => results[id]),
      opts({ authData: { c: { type: "api_key", key: "k" } } }),
    );
    const byId = Object.fromEntries(out.map((e) => [e.id, e]));
    expect(byId.a).toMatchObject({ configured: false });
    expect(byId.a.source).toBeUndefined();
    expect(byId.b.configured).toBe(false);
    expect(byId.c).toMatchObject({ configured: true, source: "stored" });
    expect(byId.d).toMatchObject({ configured: true, source: "environment", authLabel: "DEEPSEEK_API_KEY" });
  });

  it("E4: derives envVar only from an env-shaped, set variable name", async () => {
    const cases: Array<[string, string | undefined, Record<string, string>]> = [
      ["OPENAI_API_KEY", "OPENAI_API_KEY", { OPENAI_API_KEY: "x" }],
      ["OPENAI_API_KEY", undefined, {}],
      ["A_KEY, B_KEY", "B_KEY", { B_KEY: "x" }],
      ["AWS access keys", undefined, { "AWS access keys": "x" }],
      ["9KEY", undefined, { "9KEY": "x" }],
      ["", undefined, {}],
    ];
    for (const [label, expected, env] of cases) {
      const [entry] = await buildRuntimeCatalogue(
        source(["p"], async () => ({ type: "api_key", source: label })),
        opts({ env }),
      );
      expect(entry.envVar, `label=${JSON.stringify(label)}`).toBe(expected);
      if (label === "") expect(entry.authLabel).toBeUndefined();
    }
  });

  it("marks custom ids and carries displayName/hasOAuth", async () => {
    const [entry] = await buildRuntimeCatalogue(
      {
        getProviders: () => [{ id: "my-llm", name: "Mine", auth: { oauth: {} } }],
        checkAuth: async () => undefined,
      },
      opts({ customIds: new Set(["my-llm"]) }),
    );
    expect(entry).toMatchObject({ id: "my-llm", displayName: "Mine", hasOAuth: true, custom: true });
  });

  it("X2: a rejecting checkAuth degrades only that row", async () => {
    const out = await buildRuntimeCatalogue(
      source(["deepseek", "groq"], async (id) => {
        if (id === "deepseek") throw new Error("boom");
        return { type: "api_key", source: "GROQ_API_KEY" };
      }),
      opts({ env: { GROQ_API_KEY: "x" } }),
    );
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.id === "deepseek")?.configured).toBe(false);
    expect(out.find((e) => e.id === "groq")).toMatchObject({ configured: true, envVar: "GROQ_API_KEY" });
  });

  it("returns [] for corrupt auth.json without calling checkAuth", async () => {
    let calls = 0;
    const out = await buildRuntimeCatalogue(
      source(["a"], async () => {
        calls += 1;
        return undefined;
      }),
      opts({ authData: null }),
    );
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it("returns [] when getProviders throws or the source is missing/incomplete", async () => {
    expect(
      await buildRuntimeCatalogue(
        {
          getProviders: () => {
            throw new Error("x");
          },
          checkAuth: async () => undefined,
        },
        opts(),
      ),
    ).toEqual([]);
    expect(await buildRuntimeCatalogue(undefined, opts())).toEqual([]);
    expect(await buildRuntimeCatalogue({ getProviders: () => [{ id: "a" }] } as never, opts())).toEqual([]);
  });
});

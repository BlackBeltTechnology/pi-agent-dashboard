/**
 * registerEntry honors the native user-authored `~/.pi/agent/models.json`:
 * registers the UNION of discovered + native ids, resolves native capability
 * metadata (contextWindow/maxTokens/reasoning/thinkingLevelMap/compat/input/cost)
 * ahead of the enrichment fallback, and stays defensive (malformed file /
 * discovery outage → fallback, no throw).
 *
 * Driven through reloadProviders() so registerEntry runs end-to-end.
 *
 * See change: honor-native-models-json-metadata (test-plan E9/E10/X2/X3, §3).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function importFresh() {
  vi.resetModules();
  return (await import("../provider-register.js")) as typeof import("../provider-register.js");
}

function makeMockPi() {
  const registerProvider = vi.fn();
  const pi = {
    registerProvider,
    unregisterProvider: vi.fn(),
    events: { on: vi.fn(), emit: vi.fn() },
    on: vi.fn(),
  } as any;
  return { pi, registerProvider };
}

function writeProvidersJson(home: string, providers: Record<string, any>) {
  const dir = join(home, ".pi", "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "providers.json"), JSON.stringify({ providers }, null, 2), "utf-8");
}

function writeModelsJson(home: string, text: string) {
  const dir = join(home, ".pi", "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "models.json"), text, "utf-8");
}

/** The single models config passed to registerProvider for `name`. */
function lastConfig(registerProvider: any, name: string): any {
  const calls = registerProvider.mock.calls.filter((c: any[]) => c[0] === name && c[1]?.models);
  return calls[calls.length - 1]?.[1];
}
function modelById(config: any, id: string): any {
  return config?.models?.find((m: any) => m.id === id);
}

describe("registerEntry — native models.json honored", () => {
  let tmpHome: string;
  const originalHome = process.env.HOME;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "provider-native-"));
    process.env.HOME = tmpHome;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("registers the UNION of discovered ids and native models.json ids (E9)", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "a" }] }), { status: 200 }),
    ) as any;
    writeProvidersJson(tmpHome, { newapi: { baseUrl: "https://x/v1", apiKey: "k", api: "openai-completions" } });
    writeModelsJson(tmpHome, JSON.stringify({ providers: { newapi: { models: [{ id: "a" }, { id: "b" }] } } }));

    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();
    await mod.reloadProviders(pi);

    const config = lastConfig(registerProvider, "newapi");
    expect(config.models.map((m: any) => m.id).sort()).toEqual(["a", "b"]);
    // `b` is authored-only (absent from /v1/models) but still registered.
    expect(modelById(config, "b")).toBeDefined();
  });

  it("native metadata wins over the enrichment fallback, carrying map + compat (E10)", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "glm-5.2" }] }), { status: 200 }),
    ) as any;
    writeProvidersJson(tmpHome, { newapi: { baseUrl: "https://x/v1", apiKey: "k", api: "openai-completions" } });
    const map = { minimal: null, xhigh: "xhigh", max: "max" };
    const compat = { thinkingFormat: "deepseek", supportsReasoningEffort: true };
    writeModelsJson(
      tmpHome,
      JSON.stringify({
        providers: {
          newapi: {
            models: [
              {
                id: "glm-5.2",
                contextWindow: 200000,
                maxTokens: 65536,
                reasoning: true,
                thinkingLevelMap: map,
                compat,
                input: ["text", "image"],
                cost: { input: 3, output: 15 },
              },
            ],
          },
        },
      }),
    );

    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();
    await mod.reloadProviders(pi);

    const m = modelById(lastConfig(registerProvider, "newapi"), "glm-5.2");
    expect(m.contextWindow).toBe(200000);
    expect(m.maxTokens).toBe(65536);
    expect(m.reasoning).toBe(true);
    expect(m.thinkingLevelMap).toEqual(map);
    expect(m.compat).toEqual(compat);
    expect(m.input).toEqual(["text", "image"]);
    expect(m.cost).toMatchObject({ input: 3, output: 15 });
    // NOT the openai-completions fallback floors
    expect(m.contextWindow).not.toBe(128000);
  });

  it("falls back to enrichment defaults when no native entry exists (E10 negative / §3.3)", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "plain" }] }), { status: 200 }),
    ) as any;
    writeProvidersJson(tmpHome, { newapi: { baseUrl: "https://x/v1", apiKey: "k", api: "openai-completions" } });
    // no models.json

    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();
    await mod.reloadProviders(pi);

    const m = modelById(lastConfig(registerProvider, "newapi"), "plain");
    expect(m).toBeDefined();
    expect(m.contextWindow).toBe(128000); // openai-completions fallback floor
    expect(m.thinkingLevelMap).toBeUndefined();
  });

  it("malformed models.json → falls back to enrichment without throwing (X2)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "plain" }] }), { status: 200 }),
    ) as any;
    writeProvidersJson(tmpHome, { newapi: { baseUrl: "https://x/v1", apiKey: "k", api: "openai-completions" } });
    writeModelsJson(tmpHome, "{ not valid json");

    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();
    await expect(mod.reloadProviders(pi)).resolves.toBeDefined();

    const m = modelById(lastConfig(registerProvider, "newapi"), "plain");
    expect(m).toBeDefined();
    expect(m.contextWindow).toBe(128000); // fallback still applies
  });

  it("discovery outage → native-declared model still registered (X3 / AC5)", async () => {
    // /v1/models unreachable
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as any;
    writeProvidersJson(tmpHome, { newapi: { baseUrl: "https://x/v1", apiKey: "k", api: "openai-completions" } });
    writeModelsJson(
      tmpHome,
      JSON.stringify({ providers: { newapi: { models: [{ id: "glm-5.2", contextWindow: 200000, reasoning: true }] } } }),
    );

    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();
    await mod.reloadProviders(pi);

    const m = modelById(lastConfig(registerProvider, "newapi"), "glm-5.2");
    expect(m).toBeDefined();
    expect(m.contextWindow).toBe(200000);
  });
});

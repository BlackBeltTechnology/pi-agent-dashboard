/**
 * `request_models` must carry per-provider refresh failures to the browser.
 *
 * Sibling of the 0.84 refresh-contract block in `provider-register-reload.test.ts`,
 * which pins the LOG side. This pins the MESSAGE side: `models_list.refreshErrors`.
 *
 * Degraded != broken — the registry's last-known catalogue is still served, so
 * every case here uses a non-empty `getAvailable()`.
 *
 * See change: upgrade-model-selector-primitives (design D5, D6).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCommandHandler } from "../command-handler.js";

function makePi() {
  return { setSessionName: vi.fn(), getSessionName: () => "s" } as any;
}

const LAST_KNOWN = [
  { provider: "openai", id: "gpt-5", name: "gpt-5" },
  { provider: "anthropic", id: "claude", name: "claude" },
];

/** Stable projection so "degraded != broken" is asserted against the WHOLE
 *  last-known catalogue, not merely a non-empty list. */
const catalogueOf = (models: Array<Record<string, unknown>>) =>
  models.map((m) => ({ provider: m.provider, id: m.id, name: m.name }));

function makeRegistry(refreshResult: unknown) {
  return {
    authStorage: { reload: vi.fn() },
    getAvailable: vi.fn(() => LAST_KNOWN),
    refresh: vi.fn(async () => refreshResult),
  };
}

async function requestModels(registry: any): Promise<any> {
  const handler = createCommandHandler(makePi(), "sess-1", {
    getModelRegistry: () => registry,
  });
  return handler.handle({ type: "request_models", sessionId: "sess-1" } as any);
}

describe("request_models — provider refresh errors on models_list", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("names the failing provider and still serves the last-known catalogue", async () => {
    const registry = makeRegistry({
      aborted: false,
      errors: new Map([["openai", new Error("catalog 503")]]),
    });

    const res = await requestModels(registry);

    expect(res.type).toBe("models_list");
    expect(catalogueOf(res.models)).toEqual(LAST_KNOWN);
    expect(res.refreshErrors).toEqual([{ provider: "openai", message: "catalog 503" }]);
  });

  it("reports every failing provider, not only the first", async () => {
    const registry = makeRegistry({
      aborted: false,
      errors: new Map([
        ["openai", new Error("catalog 503")],
        ["anthropic", new Error("bad key")],
      ]),
    });

    const res = await requestModels(registry);

    expect(catalogueOf(res.models)).toEqual(LAST_KNOWN);
    expect(res.refreshErrors).toEqual([
      { provider: "openai", message: "catalog 503" },
      { provider: "anthropic", message: "bad key" },
    ]);
  });

  it("omits the field entirely when the refresh was merely aborted", async () => {
    const registry = makeRegistry({ aborted: true, errors: new Map() });

    const res = await requestModels(registry);

    expect(res.type).toBe("models_list");
    expect(catalogueOf(res.models)).toEqual(LAST_KNOWN);
    expect("refreshErrors" in res).toBe(false);
  });

  it("omits the field when an aborted refresh ALSO carries provider errors", async () => {
    // An abort means a newer refresh superseded this one, so its partial errors
    // describe an already-stale run. Abort stays log-only regardless.
    const registry = makeRegistry({
      aborted: true,
      errors: new Map([["openai", new Error("catalog 503")]]),
    });

    const res = await requestModels(registry);

    expect(catalogueOf(res.models)).toEqual(LAST_KNOWN);
    expect("refreshErrors" in res).toBe(false);
  });

  it("omits the field on a clean refresh", async () => {
    const registry = makeRegistry({ aborted: false, errors: new Map() });

    const res = await requestModels(registry);

    expect(catalogueOf(res.models)).toEqual(LAST_KNOWN);
    expect("refreshErrors" in res).toBe(false);
  });

  it("omits the field when a pre-0.84 registry resolves undefined", async () => {
    const registry = makeRegistry(undefined);

    const res = await requestModels(registry);

    expect(catalogueOf(res.models)).toEqual(LAST_KNOWN);
    expect("refreshErrors" in res).toBe(false);
  });
});

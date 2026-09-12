/**
 * L1 — blackhole-api getModels() unit tests (test-plan E8, E9, E27, X3).
 *
 * See change: blackhole-model-picker-chains.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getModels } from "../blackhole-api.js";

describe("getModels (E8, E9, E27, X3)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("2.1 maps slash-bearing id by slicing provider prefix (E8)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        object: "list",
        data: [{ id: "openrouter/meta/llama-3", provider: "openrouter", reasoning: true }],
      }),
    });

    const result = await getModels();
    expect(result).toEqual({
      kind: "ok",
      models: [{ provider: "openrouter", id: "meta/llama-3", reasoning: true }],
    });
  });

  it("2.2 ignores thinkingLevelMap and does not expose supportedThinkingLevels (E9)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        object: "list",
        data: [
          {
            id: "provider/test-model",
            provider: "provider",
            thinkingLevelMap: { high: null, max: "max" },
          },
        ],
      }),
    });

    const result = await getModels();
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.models.length).toBe(1);
      const model = result.models[0];
      expect(Object.hasOwn(model, "thinkingLevelMap")).toBe(false);
      expect(Object.hasOwn(model, "supportedThinkingLevels")).toBe(false);
    }
  });

  it("2.3 handles failure classes and resolves to {kind:'unavailable', reason} without rejecting (E27)", async () => {
    // Case 1: HTTP 503
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ error: "pi-ai catalogue unavailable" }),
    });
    const r1 = await getModels();
    expect(r1.kind).toBe("unavailable");
    expect(typeof (r1 as { reason: string }).reason).toBe("string");

    // Case 2: fetch rejects with network error
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network connection lost"));
    const r2 = await getModels();
    expect(r2.kind).toBe("unavailable");
    expect(typeof (r2 as { reason: string }).reason).toBe("string");

    // Case 3: HTTP 200 with non-list empty object {}
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({}),
    });
    const r3 = await getModels();
    expect(r3.kind).toBe("unavailable");
    expect(typeof (r3 as { reason: string }).reason).toBe("string");

    // Case 4: HTTP 200 with data as non-array { data: "x" }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ data: "x" }),
    });
    const r4 = await getModels();
    expect(r4.kind).toBe("unavailable");
    expect(typeof (r4 as { reason: string }).reason).toBe("string");
  });

  it("2.4 skips malformed rows and extracts provider from slash id when omitted (X3)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        object: "list",
        data: [{ id: "g/x" }, { provider: "d" }, { id: "d/y", provider: "d" }],
      }),
    });

    const result = await getModels();
    expect(result).toEqual({
      kind: "ok",
      models: [
        { provider: "g", id: "x" },
        { provider: "d", id: "y" },
      ],
    });
  });
});

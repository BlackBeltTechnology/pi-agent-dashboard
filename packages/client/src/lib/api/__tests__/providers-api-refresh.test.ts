/**
 * `refreshProviderModels(name)` — POST /api/providers/:name/refresh
 * (test-plan #E16). See change: add-provider-models-refresh.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { setGlobalApiBase } from "../api-context.js";
import { refreshProviderModels } from "../providers-api.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setGlobalApiBase("");
});

describe("refreshProviderModels", () => {
  it("POSTs to the percent-encoded route and returns the health", async () => {
    const health = { ok: true, modelCount: 7, testedAt: 1 };
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ success: true, health }), { status: 200, headers: { "content-type": "application/json" } }));
    globalThis.fetch = fetchSpy as typeof fetch;
    const result = await refreshProviderModels("a/b");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/providers\/a%2Fb\/refresh$/);
    expect(init.method).toBe("POST");
    expect(result).toEqual({ ok: true, health });
  });

  it("maps a non-2xx response to an error result", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: false, error: "Provider \"x\" not found" }), { status: 404, headers: { "content-type": "application/json" } }),
    ) as typeof fetch;
    expect(await refreshProviderModels("x")).toEqual({ ok: false, error: "Provider \"x\" not found" });
  });

  it("maps a network failure to an error result without throwing", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("offline"); }) as typeof fetch;
    expect(await refreshProviderModels("x")).toEqual({ ok: false, error: "offline" });
  });
});

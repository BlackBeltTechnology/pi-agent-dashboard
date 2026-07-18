/**
 * Unit tests for model-proxy-api.ts client helpers (task 12.2).
 * Uses fetch mocking (vi.stubGlobal) to avoid msw dependency.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as modelProxyApi from "../api/model-proxy-api.js";

// ── Mock fetch ────────────────────────────────────────────────────────────

function mockFetch(status: number, body: any) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  // api-context returns "" in test env (no window.location setup needed)
  vi.stubGlobal("fetch", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("listApiKeys", () => {
  it("returns parsed keys on success", async () => {
    const data = {
      keys: [{ id: "k1", label: "Test", scopes: ["all"], createdAt: 1000, hash: "***" }],
      revoked: [],
    };
    vi.stubGlobal("fetch", mockFetch(200, { success: true, data }));

    const result = await modelProxyApi.listApiKeys();
    expect(result.keys).toHaveLength(1);
    expect(result.keys[0].id).toBe("k1");
    expect(result.revoked).toEqual([]);
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetch(401, { code: "UNAUTHORIZED" }));
    await expect(modelProxyApi.listApiKeys()).rejects.toThrow("listApiKeys failed: 401");
  });
});

describe("createApiKey", () => {
  it("POSTs with label and returns created key", async () => {
    const data = { id: "k1", label: "My Key", scopes: ["all"], createdAt: 1000, key: "pi-proxy-abc" };
    const fakeFetch = mockFetch(201, { success: true, data });
    vi.stubGlobal("fetch", fakeFetch);

    const result = await modelProxyApi.createApiKey({ label: "My Key" });
    expect(result.key).toBe("pi-proxy-abc");
    expect(result.label).toBe("My Key");

    // Verify POST with correct body
    const [, opts] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string).label).toBe("My Key");
  });

  it("includes custom scopes in request body", async () => {
    const data = { id: "k1", label: "My Key", scopes: ["models:list"], createdAt: 1000, key: "pi-proxy-xyz" };
    const fakeFetch = mockFetch(201, { success: true, data });
    vi.stubGlobal("fetch", fakeFetch);

    await modelProxyApi.createApiKey({ label: "My Key", scopes: ["models:list"] });

    const [, opts] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string).scopes).toEqual(["models:list"]);
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetch(400, { error: "label required" }));
    await expect(modelProxyApi.createApiKey({ label: "" })).rejects.toThrow("createApiKey failed: 400");
  });
});

describe("revokeApiKey", () => {
  it("POSTs to the revoke endpoint", async () => {
    const fakeFetch = mockFetch(204, null);
    vi.stubGlobal("fetch", fakeFetch);

    await modelProxyApi.revokeApiKey("k1");

    const [url, opts] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/k1/revoke");
    expect(opts.method).toBe("POST");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetch(404, {}));
    await expect(modelProxyApi.revokeApiKey("k99")).rejects.toThrow("revokeApiKey failed: 404");
  });
});

describe("deleteApiKey", () => {
  it("DELETEs the key endpoint", async () => {
    const fakeFetch = mockFetch(204, null);
    vi.stubGlobal("fetch", fakeFetch);

    await modelProxyApi.deleteApiKey("k1");

    const [url, opts] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/k1");
    expect(opts.method).toBe("DELETE");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetch(403, {}));
    await expect(modelProxyApi.deleteApiKey("k99")).rejects.toThrow("deleteApiKey failed: 403");
  });
});

describe("refreshRegistry", () => {
  it("POSTs to the refresh endpoint", async () => {
    const fakeFetch = mockFetch(200, {});
    vi.stubGlobal("fetch", fakeFetch);

    await modelProxyApi.refreshRegistry();

    const [url, opts] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/model-proxy/refresh");
    expect(opts.method).toBe("POST");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetch(503, {}));
    await expect(modelProxyApi.refreshRegistry()).rejects.toThrow("refreshRegistry failed: 503");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeRemoteUrl, probeRemote } from "../lib/remote-probe.js";

describe("normalizeRemoteUrl", () => {
  it("defaults to http:// and strips trailing slashes", () => {
    expect(normalizeRemoteUrl("192.168.16.242:8000")).toBe("http://192.168.16.242:8000");
    expect(normalizeRemoteUrl("http://host:8000/")).toBe("http://host:8000");
    expect(normalizeRemoteUrl("https://host:8443//")).toBe("https://host:8443");
  });

  it("returns null for empty / non-string input", () => {
    expect(normalizeRemoteUrl("")).toBeNull();
    expect(normalizeRemoteUrl("   ")).toBeNull();
    expect(normalizeRemoteUrl(undefined)).toBeNull();
    expect(normalizeRemoteUrl(42)).toBeNull();
  });
});

describe("probeRemote", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns ok with version on a healthy 200 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "0.5.4" }),
    });
    expect(await probeRemote("http://192.168.16.242:8000")).toEqual({ ok: true, version: "0.5.4" });
  });

  it("returns ok with undefined version when body has no version", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    expect(await probeRemote("http://host:8000")).toEqual({ ok: true, version: undefined });
  });

  it("returns ok even when the health body is non-JSON", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error("not json")),
    });
    expect(await probeRemote("http://host:8000")).toEqual({ ok: true, version: undefined });
  });

  it("reports the HTTP status on a non-200 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    expect(await probeRemote("http://host:8000")).toEqual({ ok: false, reason: "HTTP 503" });
  });

  it("reports 'Timed out' when the request aborts", async () => {
    const err = new Error("aborted");
    (err as Error).name = "AbortError";
    globalThis.fetch = vi.fn().mockRejectedValue(err);
    expect(await probeRemote("http://host:8000")).toEqual({ ok: false, reason: "Timed out" });
  });

  it("reports 'Connection refused' on a network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("fetch failed"));
    expect(await probeRemote("http://host:8000")).toEqual({ ok: false, reason: "Connection refused" });
  });

  it("probes the /api/health path", async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    globalThis.fetch = spy;
    await probeRemote("http://host:8000");
    expect(spy).toHaveBeenCalledWith("http://host:8000/api/health", expect.any(Object));
  });
});

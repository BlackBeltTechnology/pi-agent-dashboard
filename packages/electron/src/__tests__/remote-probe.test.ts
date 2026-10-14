import { afterEach, describe, expect, it, vi } from "vitest";
import { isBlockedProbeAddress, normalizeRemoteUrl, probeRemote } from "../lib/remote-probe.js";

/** Deterministic offline resolver: every hostname resolves to a public address. */
const publicResolver = async () => ["93.184.216.34"];

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
    expect(await probeRemote("http://192.168.16.242:8000", publicResolver)).toEqual({ ok: true, version: "0.5.4" });
  });

  it("returns ok with undefined version when body has no version", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    expect(await probeRemote("http://host:8000", publicResolver)).toEqual({ ok: true, version: undefined });
  });

  it("returns ok even when the health body is non-JSON", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error("not json")),
    });
    expect(await probeRemote("http://host:8000", publicResolver)).toEqual({ ok: true, version: undefined });
  });

  it("reports the HTTP status on a non-200 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    expect(await probeRemote("http://host:8000", publicResolver)).toEqual({ ok: false, reason: "HTTP 503" });
  });

  it("reports 'Timed out' when the request aborts", async () => {
    const err = new Error("aborted");
    (err as Error).name = "AbortError";
    globalThis.fetch = vi.fn().mockRejectedValue(err);
    expect(await probeRemote("http://host:8000", publicResolver)).toEqual({ ok: false, reason: "Timed out" });
  });

  it("reports 'Connection refused' on a network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("fetch failed"));
    expect(await probeRemote("http://host:8000", publicResolver)).toEqual({ ok: false, reason: "Connection refused" });
  });

  it("probes the /api/health path", async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    globalThis.fetch = spy;
    await probeRemote("http://host:8000", publicResolver);
    expect(spy).toHaveBeenCalledWith("http://host:8000/api/health", expect.any(Object));
  });
});

describe("isBlockedProbeAddress (B10)", () => {
  it.each([
    "169.254.169.254", "169.254.0.1", "0.0.0.0", "0.1.2.3",
    "fe80::1", "febf::1", "::", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::ffff:0.0.0.0",
    "not-an-ip", "",
  ])("blocks %s", (addr) => {
    expect(isBlockedProbeAddress(addr)).toBe(true);
  });

  it.each([
    "93.184.216.34", "127.0.0.1", "10.0.0.5", "192.168.16.242", "172.16.0.1", "100.64.0.1",
    "::1", "fd00::1", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:192.168.1.5", "fec0::1",
  ])("allows %s (loopback / private / public are legitimate remotes)", (addr) => {
    expect(isBlockedProbeAddress(addr)).toBe(false);
  });
});

describe("probeRemote SSRF guard (B10)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("refuses the cloud-metadata IP literal without fetching", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy;
    expect(await probeRemote("http://169.254.169.254")).toEqual({ ok: false, reason: "Target not allowed" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses non-canonical metadata encodings (decimal / hex / mapped v6)", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy;
    for (const u of ["http://2852039166", "http://0xa9fea9fe", "http://[::ffff:169.254.169.254]", "http://[fe80::1]:8000"]) {
      expect(await probeRemote(u), u).toEqual({ ok: false, reason: "Target not allowed" });
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a hostname that RESOLVES to link-local (any address of several)", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy;
    const r = await probeRemote("http://evil.example", async () => ["93.184.216.34", "169.254.169.254"]);
    expect(r).toEqual({ ok: false, reason: "Target not allowed" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("allows private + loopback targets (LAN dashboards are the main use case)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ version: "1" }) });
    expect(await probeRemote("http://192.168.16.242:8000")).toEqual({ ok: true, version: "1" });
    expect(await probeRemote("http://10.0.0.5:8000")).toEqual({ ok: true, version: "1" });
    expect(await probeRemote("http://localhost:8000", async () => ["127.0.0.1"])).toEqual({ ok: true, version: "1" });
    expect(await probeRemote("http://[::1]:8000")).toEqual({ ok: true, version: "1" });
  });

  it("reports an unresolvable host as unreachable without fetching", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy;
    const r = await probeRemote("http://nope.invalid", async () => { throw new Error("ENOTFOUND"); });
    expect(r).toEqual({ ok: false, reason: "Connection refused" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("still fetches only /api/health for an allowed public host", async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    globalThis.fetch = spy;
    await probeRemote("http://public.example:8000", publicResolver);
    expect(spy).toHaveBeenCalledWith("http://public.example:8000/api/health", expect.any(Object));
  });
});

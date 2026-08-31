import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isDashboardRunning } from "../server-identity.js";

describe("isDashboardRunning", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns running: true with pid when health endpoint responds correctly", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, pid: 12345, uptime: 60 }),
    });

    const result = await isDashboardRunning(8000);
    expect(result).toEqual({ running: true, pid: 12345 });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns portConflict when port returns non-ok HTTP status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await isDashboardRunning(8000);
    expect(result).toEqual({ running: false, portConflict: true });
  });

  it("returns portConflict when response is HTTP 200 but not dashboard format", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: "ok", service: "nginx" }),
    });

    const result = await isDashboardRunning(8000);
    expect(result).toEqual({ running: false, portConflict: true });
  });

  it("returns running: false when connection refused (nothing running)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await isDashboardRunning(8000);
    // Public shape stays frozen — the internal refusal flag never leaks.
    expect(result).toEqual({ running: false });
  });

  it("returns running: false when request times out", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    const result = await isDashboardRunning(8000);
    expect(result).toEqual({ running: false });
  });

  it("uses custom host when provided", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, pid: 999 }),
    });

    await isDashboardRunning(8000, "192.168.1.10");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://192.168.1.10:8000/api/health",
      expect.any(Object),
    );
  });

  it("returns version from health response when present", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, pid: 12345, version: "1.2.3" }),
    });
    const result = await isDashboardRunning(8000);
    expect(result).toEqual({ running: true, pid: 12345, version: "1.2.3" });
  });
});

describe("isDashboardRunning retry semantics (cherry-pick 2)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("single-shot is the default (retries=0, 1 attempt)", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    globalThis.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("timeout"), { name: "AbortError" }),
    );
    const result = await isDashboardRunning(8000, "localhost", { _sleep: sleep });
    expect(result).toEqual({ running: false });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries=2 with two transient failures then success returns running:true", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const abort = Object.assign(new Error("timeout"), { name: "AbortError" });
    let call = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      call++;
      if (call < 3) return Promise.reject(abort);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, pid: 999 }),
      } as Response);
    });

    const result = await isDashboardRunning(8000, "localhost", {
      retries: 2,
      retryDelayMs: 100,
      _sleep: sleep,
    });
    expect(result).toEqual({ running: true, pid: 999 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 100);
  });

  it("portConflict:true short-circuits retries", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: "ok", service: "nginx" }),
    } as Response);

    const result = await isDashboardRunning(8000, "localhost", {
      retries: 5,
      _sleep: sleep,
    });
    expect(result).toEqual({ running: false, portConflict: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("ECONNREFUSED with default retries=0 returns running:false without retry", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await isDashboardRunning(8000, "localhost", { _sleep: sleep });
    expect(result).toEqual({ running: false });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  // fix-autostart-discovery-precedence (F7/D1): a REAL Node fetch refusal is
  // a TypeError with cause.code === "ECONNREFUSED" — definitive "nothing
  // listens" — and must short-circuit the retry loop exactly like
  // portConflict: the bootstrap-aware resolved-port gate must not pay retry
  // delays on a cold start. Public shape stays frozen; the short-circuit is
  // proven behaviorally (exactly one fetch, zero sleeps).
  it("real-shape ECONNREFUSED (TypeError with cause.code) short-circuits retries", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8000"), { code: "ECONNREFUSED" }),
    });
    globalThis.fetch = vi.fn().mockRejectedValue(refused);

    const result = await isDashboardRunning(8000, "localhost", {
      retries: 3,
      _sleep: sleep,
    });
    expect(result).toEqual({ running: false });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // no retries paid
    expect(sleep).not.toHaveBeenCalled();
  });

  it("exhausted retries return the last non-success result", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    globalThis.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("timeout"), { name: "AbortError" }),
    );
    const result = await isDashboardRunning(8000, "localhost", {
      retries: 3,
      _sleep: sleep,
    });
    expect(result).toEqual({ running: false });
    expect(globalThis.fetch).toHaveBeenCalledTimes(4); // 1 + 3 retries
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("custom timeoutMs is passed to AbortController", async () => {
    // Indirect assertion: with timeoutMs=10 and a fetch that takes 50ms,
    // the abort fires and we get running:false. With timeoutMs=200, the
    // same fetch succeeds.
    const makeSlowFetch = (delayMs: number) =>
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: () => Promise.resolve({ ok: true, pid: 1 }),
                } as Response),
              delayMs,
            );
            init.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      );

    globalThis.fetch = makeSlowFetch(50);
    const tight = await isDashboardRunning(8000, "localhost", { timeoutMs: 10 });
    expect(tight).toEqual({ running: false });

    globalThis.fetch = makeSlowFetch(10);
    const loose = await isDashboardRunning(8000, "localhost", { timeoutMs: 200 });
    expect(loose).toEqual({ running: true, pid: 1 });
  });
});

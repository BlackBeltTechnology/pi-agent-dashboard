import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  probeTunnel,
  startTunnelWatchdog,
  stopTunnelWatchdog,
  getTunnelWatchdogStatus,
  _runTickForTest,
  _resetForTest,
} from "../tunnel/tunnel-watchdog.js";

const URL = "https://abc.share.zrok.io";

function makeFetch(responses: Array<Response | Error>): typeof fetch {
  let i = 0;
  return (async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
}

describe("probeTunnel", () => {
  it("returns ok on 2xx", async () => {
    const f = makeFetch([new Response("{}", { status: 200 })]);
    expect(await probeTunnel(URL, 1000, f)).toEqual({ ok: true, status: 200 });
  });

  it("returns ok on 4xx (auth gate proves edge↔local works)", async () => {
    const f = makeFetch([new Response("", { status: 401 })]);
    expect(await probeTunnel(URL, 1000, f)).toEqual({ ok: true, status: 401 });
  });

  it("returns NOT ok on 5xx", async () => {
    const f = makeFetch([new Response("bad gateway", { status: 502 })]);
    const r = await probeTunnel(URL, 1000, f);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(502);
    expect(r.reason).toMatch(/502/);
  });

  it("returns NOT ok on network error", async () => {
    const f = makeFetch([new Error("ENOTFOUND")]);
    const r = await probeTunnel(URL, 1000, f);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ENOTFOUND/);
  });
});

describe("watchdog lifecycle", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); });

  it("does not start when disabled", () => {
    startTunnelWatchdog(
      { getUrl: () => URL, recycle: vi.fn(async () => URL) },
      { enabled: false },
    );
    expect(getTunnelWatchdogStatus()).toBeNull();
  });

  it("recycles after threshold consecutive 5xx", async () => {
    const recycle = vi.fn(async () => URL);
    const fetchFn = makeFetch([
      new Response("", { status: 502 }),
      new Response("", { status: 502 }),
    ]);
    startTunnelWatchdog(
      { getUrl: () => URL, recycle, fetchFn, log: () => {} },
      { intervalMs: 1000, failureThreshold: 2, probeTimeoutMs: 500 },
    );
    await _runTickForTest();
    expect(recycle).not.toHaveBeenCalled();
    expect(getTunnelWatchdogStatus()?.consecutiveFailures).toBe(1);

    await _runTickForTest();
    expect(recycle).toHaveBeenCalledTimes(1);
    const s = getTunnelWatchdogStatus()!;
    expect(s.consecutiveFailures).toBe(0);
    expect(s.recycleCount).toBe(1);
    expect(s.lastRecycleAt).toBeGreaterThan(0);
  });

  it("does not recycle on a single failure surrounded by success", async () => {
    const recycle = vi.fn(async () => URL);
    const fetchFn = makeFetch([
      new Response("", { status: 200 }),
      new Response("", { status: 502 }),
      new Response("", { status: 200 }),
    ]);
    startTunnelWatchdog(
      { getUrl: () => URL, recycle, fetchFn, log: () => {} },
      { intervalMs: 1000, failureThreshold: 2, probeTimeoutMs: 500 },
    );
    await _runTickForTest();
    await _runTickForTest();
    await _runTickForTest();
    expect(recycle).not.toHaveBeenCalled();
    expect(getTunnelWatchdogStatus()?.consecutiveFailures).toBe(0);
  });

  it("treats recycle failure as a no-op for stats but flags it for backoff", async () => {
    const recycle = vi.fn(async () => null); // recycle returned no URL
    const fetchFn = makeFetch([
      new Response("", { status: 502 }),
      new Response("", { status: 502 }),
    ]);
    startTunnelWatchdog(
      { getUrl: () => URL, recycle, fetchFn, log: () => {} },
      { intervalMs: 1000, failureThreshold: 2, probeTimeoutMs: 500 },
    );
    await _runTickForTest();
    await _runTickForTest();
    expect(recycle).toHaveBeenCalledTimes(1);
    expect(getTunnelWatchdogStatus()?.recycleCount).toBe(1);
  });

  it("skips probing when no tunnel URL", async () => {
    const recycle = vi.fn(async () => URL);
    const fetchFn = vi.fn();
    startTunnelWatchdog(
      { getUrl: () => null, recycle, fetchFn: fetchFn as any, log: () => {} },
      { intervalMs: 1000, failureThreshold: 2, probeTimeoutMs: 500 },
    );
    await _runTickForTest();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(recycle).not.toHaveBeenCalled();
  });

  it("stop clears state", () => {
    startTunnelWatchdog(
      { getUrl: () => URL, recycle: vi.fn(async () => URL), log: () => {} },
      { intervalMs: 1000 },
    );
    expect(getTunnelWatchdogStatus()).not.toBeNull();
    stopTunnelWatchdog();
    expect(getTunnelWatchdogStatus()).toBeNull();
  });
});

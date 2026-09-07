/**
 * L1 — client boot gate (test-plan F1, F4, X1, X2; tasks 4.1/4.2).
 *
 * Contract (design D4):
 *  - `shouldRenderMemorySubcard()` is synchronous and fails closed until a
 *    successful resolve (F1)
 *  - a fetch that fails ×4 then succeeds produces exactly 3 capped-backoff
 *    retries + a slow-interval attempt, flips the gate, bumps the slot-claims
 *    store EXACTLY once, and stops polling (X1)
 *  - 404 / 500 / garbage-body are each transient: retry continues, the gate
 *    stays false, the value is never finalized (X2)
 *  - importing the client entry under vitest issues no network request (F4),
 *    while `resolveInstalled` remains explicitly invokable
 *
 * See change: add-blackhole-session-pipeline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bumpSlotClaimsVersion } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  __resetInstalledGateForTests,
  isTestEnvironment,
  resolveInstalled,
  shouldRenderMemorySubcard,
} from "../installed-gate.js";

vi.mock("@blackbelt-technology/dashboard-plugin-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/dashboard-plugin-runtime")>();
  return { ...actual, bumpSlotClaimsVersion: vi.fn(actual.bumpSlotClaimsVersion) };
});

const bumps = vi.mocked(bumpSlotClaimsVersion);

function jsonRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** A fetch impl failing `failTimes` times (network error), then returning 200 installed. */
function flakyFetch(failTimes: number, installed = true): { fetch: typeof fetch; calls: () => number } {
  let n = 0;
  const impl = (async () => {
    n += 1;
    if (n <= failTimes) throw new TypeError("network down");
    return jsonRes(200, { installed });
  }) as typeof fetch;
  return { fetch: impl, calls: () => n };
}

beforeEach(() => {
  __resetInstalledGateForTests();
  bumps.mockClear();
});
afterEach(() => {
  __resetInstalledGateForTests();
  vi.useRealTimers();
});

/** Drain microtasks so the in-flight fetch settles. Fake timers fake `setTimeout`, so a real macrotask is unavailable — microtasks still run. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe("shouldRenderMemorySubcard — sync fail-closed (F1)", () => {
  it("returns false synchronously before any resolve", () => {
    expect(shouldRenderMemorySubcard({ id: "s" })).toBe(false);
  });
});

describe("resolveInstalled — transient failures then success (X1)", () => {
  it("fails ×4 then succeeds: 3 backoff retries + slow-interval attempt, one bump, no further polling", async () => {
    vi.useFakeTimers();
    const { fetch, calls } = flakyFetch(4);
    resolveInstalled({ fetchImpl: fetch, backoffMs: [1_000, 2_000, 4_000], slowIntervalMs: 60_000 });

    await flush(); // attempt 1 (network error)
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000); await flush(); // retry 1 @1s
    expect(calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(2_000); await flush(); // retry 2 @2s
    expect(calls()).toBe(3);
    await vi.advanceTimersByTimeAsync(4_000); await flush(); // retry 3 @4s
    expect(calls()).toBe(4);
    await vi.advanceTimersByTimeAsync(60_000); await flush(); // slow interval
    expect(calls()).toBe(5); // succeeds here — fails ×4, 5th succeeds
    expect(shouldRenderMemorySubcard({ id: "s" })).toBe(true);
    expect(bumps).toHaveBeenCalledTimes(1);

    // No re-poll after success: time passes, nothing more is requested.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await flush();
    expect(calls()).toBe(5);
    expect(bumps).toHaveBeenCalledTimes(1);
  });
});

describe("resolveInstalled — non-200 / malformed are transient (X2)", () => {
  it.each([
    ["404", async () => jsonRes(404, { error: "not found" })],
    ["500", async () => jsonRes(500, { error: "boom" })],
    ["garbage body", async () => jsonRes(200, { hello: "world" })],
  ])("%s is treated as transient — gate never finalizes", async (_name, respond) => {
    vi.useFakeTimers();
    let n = 0;
    let succeed = false;
    const fetch = (async () => {
      n += 1;
      if (succeed) return jsonRes(200, { installed: true });
      return respond();
    }) as typeof fetch;
    resolveInstalled({ fetchImpl: fetch, backoffMs: [10, 10, 10], slowIntervalMs: 20 });

    await flush();
    expect(n).toBe(1);
    expect(shouldRenderMemorySubcard({ id: "s" })).toBe(false); // still closed
    await vi.advanceTimersByTimeAsync(10); await flush();
    await vi.advanceTimersByTimeAsync(10); await flush();
    expect(n).toBe(3); // retrying, not finalized
    expect(shouldRenderMemorySubcard({ id: "s" })).toBe(false);
    expect(bumps).not.toHaveBeenCalled();

    // Eventually succeeds → gate opens (never gives up).
    succeed = true;
    await vi.advanceTimersByTimeAsync(20); await flush();
    expect(shouldRenderMemorySubcard({ id: "s" })).toBe(true);
    expect(bumps).toHaveBeenCalledTimes(1);
  });

  it("a successful resolve of `false` is authoritative and final", async () => {
    vi.useFakeTimers();
    const { fetch, calls } = flakyFetch(0, false);
    resolveInstalled({ fetchImpl: fetch });
    await flush();
    expect(calls()).toBe(1);
    expect(shouldRenderMemorySubcard({ id: "s" })).toBe(false);
    expect(bumps).toHaveBeenCalledTimes(1); // a bump on a definitive false is correct: gates re-eval, stay closed
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await flush();
    expect(calls()).toBe(1);
  });
});

describe("module-scope kick guard (F4)", () => {
  it("detects the test environment via injected override and import.meta/process probes", () => {
    expect(isTestEnvironment(true)).toBe(true);
    expect(isTestEnvironment(false)).toBe(false);
    // Under vitest, process.env.VITEST is set — the typeof-guarded read must
    // agree rather than throw.
    expect(isTestEnvironment()).toBe(true);
  });
});

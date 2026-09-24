import { afterEach, describe, expect, it, vi } from "vitest";
import { djb2, SessionDiffCache } from "../session-diff-cache.js";

describe("djb2", () => {
  it("is deterministic and differs on input change", () => {
    expect(djb2("a")).toBe(djb2("a"));
    expect(djb2(" M a.ts")).not.toBe(djb2(" M b.ts"));
  });
});

describe("SessionDiffCache — TTL + single-flight (6.5)", () => {
  it("returns the cached result within TTL without recomputing", async () => {
    const cache = new SessionDiffCache<number>(1000);
    const compute = vi.fn(async () => 42);
    expect(await cache.run("k", compute)).toBe(42);
    expect(await cache.run("k", compute)).toBe(42);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent identical requests onto ONE computation", async () => {
    const cache = new SessionDiffCache<number>(1000);
    let resolveIt: (n: number) => void = () => {};
    const compute = vi.fn(
      () =>
        new Promise<number>((res) => {
          resolveIt = res;
        }),
    );
    const a = cache.run("k", compute);
    const b = cache.run("k", compute);
    resolveIt(7);
    expect(await a).toBe(7);
    expect(await b).toBe(7);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("recomputes after TTL expiry (state-change key bust is caller-driven)", async () => {
    const cache = new SessionDiffCache<number>(50);
    const compute = vi.fn(async () => 1);
    await cache.run("k", compute);
    await new Promise((r) => setTimeout(r, 70));
    await cache.run("k", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("a different key (HEAD/dirty change) always recomputes", async () => {
    const cache = new SessionDiffCache<number>(1000);
    const compute = vi.fn(async () => 1);
    await cache.run("sess:sha1:dirtyA", compute);
    await cache.run("sess:sha2:dirtyA", compute); // HEAD changed
    await cache.run("sess:sha1:dirtyB", compute); // dirty-sig changed
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("TTL 0 disables result caching (always recompute)", async () => {
    const cache = new SessionDiffCache<number>(0);
    const compute = vi.fn(async () => 1);
    await cache.run("k", compute);
    await cache.run("k", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

// ── Byte budget + expiry on access (fix-session-diff-heap-retention D2/D4) ──

type Sized = { n: number };
const sized = (n: number) => async (): Promise<Sized> => ({ n });
function budgetCache(maxBytes = 100, ttlMs = 1000): SessionDiffCache<Sized> {
  return new SessionDiffCache<Sized>(ttlMs, 100, { maxBytes, sizeOf: (v) => v.n });
}

describe("SessionDiffCache — byte budget", () => {
  it("E5/E6: evicts oldest only once the budget is exceeded", async () => {
    const cache = budgetCache(100);
    await cache.run("a", sized(40));
    await cache.run("b", sized(40));
    await cache.run("c", sized(20));
    expect(cache.size).toBe(3);
    expect(cache.totalBytes).toBe(100);

    await cache.run("d", sized(1));
    expect(cache.size).toBe(3);
    expect(cache.totalBytes).toBe(61);
    // "a" (oldest) was evicted → recomputes.
    const again = vi.fn(sized(40));
    await cache.run("a", again);
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("E7/E8: a single over-budget entry stays cached until displaced", async () => {
    const cache = budgetCache(100);
    await cache.run("a", sized(30));
    const computeB = vi.fn(sized(150));
    await cache.run("b", computeB);
    expect(cache.size).toBe(1);
    expect(cache.totalBytes).toBe(150);
    await cache.run("b", computeB);
    expect(computeB).toHaveBeenCalledTimes(1);

    await cache.run("c", sized(10));
    expect(cache.size).toBe(1);
    expect(cache.totalBytes).toBe(10);
  });
});

describe("SessionDiffCache — expiry on access + accounting", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("E9: expired entries are released on the next access, below maxEntries", async () => {
    vi.useFakeTimers();
    const cache = budgetCache(1000, 2000);
    await cache.run("k1", sized(50));
    vi.advanceTimersByTime(2001);
    await cache.run("k2", sized(7));
    expect(cache.size).toBe(1);
    expect(cache.totalBytes).toBe(7);
  });

  it("E10: overwriting an expired key does not double-count bytes", async () => {
    vi.useFakeTimers();
    const cache = budgetCache(1000, 2000);
    await cache.run("k1", sized(50));
    vi.advanceTimersByTime(2001);
    await cache.run("k1", sized(70));
    expect(cache.size).toBe(1);
    expect(cache.totalBytes).toBe(70);
  });

  it("E12: default ctor is count-capped only (no byte eviction)", async () => {
    const cache = new SessionDiffCache<Sized>();
    for (let i = 0; i < 101; i++) await cache.run(`k${i}`, sized(10_000_000));
    expect(cache.size).toBe(100);
    expect(cache.totalBytes).toBe(0);
  });
});

import { describe, expect, it, vi } from "vitest";
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

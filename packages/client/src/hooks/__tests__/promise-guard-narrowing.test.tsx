/**
 * The D6 narrowing rewrites must preserve inflight memoization exactly.
 * See change: cleanup-client-plugin-promises (test-plan #E2, #E3, #E4).
 *
 * Harness glue mirrors `packages/client/src/hooks/__tests__/useAsyncAction.test.tsx`.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetGhAvailableCache,
  probeGhAvailable,
} from "../../components/worktree/WorktreeActionsMenu.js";
import {
  __resetHostPlatformCacheForTests,
  useHostPlatform,
} from "../useHostPlatform.js";
import {
  __resetLaunchSourceCacheForTests,
  useLaunchSource,
} from "../useLaunchSource.js";

const fetchTool = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api/tools-api.js", () => ({ fetchTool }));

function deferredAfter<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

beforeEach(() => {
  __resetGhAvailableCache();
  __resetHostPlatformCacheForTests();
  __resetLaunchSourceCacheForTests();
  fetchTool.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("E2: `undefined`-variant narrowing preserves inflight memoization", () => {
  it("two calls in the same tick share one fetch and one promise reference", async () => {
    fetchTool.mockImplementation(() => deferredAfter({ ok: true }, 50));

    const first = probeGhAvailable();
    const second = probeGhAvailable();

    expect(fetchTool).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });
});

describe("E4: guard precedence across the three reachable states", () => {
  it("state 3 (cache unset, inflight unset) → exactly one fetch", async () => {
    fetchTool.mockImplementation(() => deferredAfter({ ok: true }, 10));

    await probeGhAvailable();

    expect(fetchTool).toHaveBeenCalledTimes(1);
  });

  it("state 2 (cache unset, inflight set) → returns the in-flight promise, zero new fetches", async () => {
    fetchTool.mockImplementation(() => deferredAfter({ ok: true }, 50));

    const inflight = probeGhAvailable(); // cache still unset while pending
    fetchTool.mockClear();

    const again = probeGhAvailable();

    expect(fetchTool).not.toHaveBeenCalled();
    expect(again).toBe(inflight);
    await inflight;
  });

  it("state 1 (cache set) → returns the cached value, zero fetches", async () => {
    fetchTool.mockImplementation(() => deferredAfter({ ok: false }, 10));
    await probeGhAvailable(); // populates the cache
    fetchTool.mockClear();

    const cachedResult = await probeGhAvailable();

    expect(fetchTool).not.toHaveBeenCalled();
    expect(cachedResult).toBe(false);
  });
});

describe("E3: `null`-variant narrowing preserves inflight memoization", () => {
  it("useHostPlatform: two concurrent mounts probe /api/health exactly once", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        deferredAfter(
          { ok: true, json: () => Promise.resolve({ platform: "linux" }) } as Response,
          50,
        ),
    );

    const a = renderHook(() => useHostPlatform());
    const b = renderHook(() => useHostPlatform());

    await waitFor(() => expect(a.result.current).toBe("linux"));
    await waitFor(() => expect(b.result.current).toBe("linux"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("useLaunchSource: two concurrent mounts probe /api/health exactly once", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        deferredAfter(
          {
            ok: true,
            json: () => Promise.resolve({ launchSource: "electron" }),
          } as Response,
          50,
        ),
    );

    const a = renderHook(() => useLaunchSource());
    const b = renderHook(() => useLaunchSource());

    await waitFor(() => expect(a.result.current).toBe("electron"));
    await waitFor(() => expect(b.result.current).toBe("electron"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

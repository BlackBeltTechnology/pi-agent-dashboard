/**
 * A `useEffect` promise fix must not break the cleanup contract
 * (test-plan #F5) and must report rather than swallow (test-plan #X1, unit half).
 *
 * `useInitStatus` is a representative touched site: effect-scoped async work,
 * an `alive` guard, and a `.catch(logRejection(…))` discard.
 *
 * Harness glue mirrors
 * `packages/client/src/hooks/__tests__/useMessageHandler.asset-register.test.tsx`.
 *
 * See change: cleanup-client-plugin-promises.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInitStatus } from "../useInitStatus.js";

const fetchWorktreeInitStatus = vi.hoisted(() => vi.fn());
vi.mock("../../lib/git/git-api.js", () => ({ fetchWorktreeInitStatus }));

let consoleError: { mock: { calls: unknown[][] } };

beforeEach(() => {
  fetchWorktreeInitStatus.mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A promise plus its settle triggers, so the test controls the timing. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("F5: the effect cleanup contract survives the promise fix", () => {
  it("the effect callback returns a cleanup function, never a promise", () => {
    fetchWorktreeInitStatus.mockReturnValue(deferred<unknown>().promise);

    // If the effect returned a promise, React would warn about it here.
    const { unmount } = renderHook(() => useInitStatus("/repo"));
    unmount();

    const warned = consoleError.mock.calls.some((c: unknown[]) =>
      /effect function must not return anything besides a function|returned a Promise/i.test(
        c.map(String).join(" "),
      ),
    );
    expect(warned).toBe(false);
  });

  it("resolving AFTER unmount performs no state update and emits no warning", async () => {
    const d = deferred<{ hasHook: boolean }>();
    fetchWorktreeInitStatus.mockReturnValue(d.promise);

    const { result, unmount } = renderHook(() => useInitStatus("/repo"));
    unmount();

    d.resolve({ hasHook: true });
    await d.promise;
    await Promise.resolve();

    // The `alive` guard held: no post-unmount state landed.
    expect(result.current.status).toBeNull();
    const warned = consoleError.mock.calls.some((c: unknown[]) =>
      /not wrapped in act|state update on an unmounted/i.test(c.map(String).join(" ")),
    );
    expect(warned).toBe(false);
  });

  it("X1: rejecting AFTER unmount is reported, not swallowed and not unhandled", async () => {
    const d = deferred<never>();
    fetchWorktreeInitStatus.mockReturnValue(d.promise);

    const { unmount } = renderHook(() => useInitStatus("/repo"));
    unmount();

    const boom = new Error("probe aborted mid-flight");
    d.reject(boom);
    await d.promise.catch(() => {});
    await Promise.resolve();

    // The handler ran: the reason reached the client's console-error path with
    // its site named. An empty `.catch` would fail this.
    const reported = consoleError.mock.calls.find((c: unknown[]) =>
      c.includes(boom),
    );
    expect(reported).toBeDefined();
    expect(String(reported?.[0])).toContain("useInitStatus.fetch");
  });
});

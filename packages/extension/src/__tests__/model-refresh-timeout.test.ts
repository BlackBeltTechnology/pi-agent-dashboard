/**
 * `reportRefresh` must never block its caller indefinitely.
 *
 * `request_models` awaits a provider catalogue refresh; a refresh that never
 * settles used to hang the awaiting handler forever. The bounded wait degrades
 * to the last-known catalogue instead.
 * See change: fix-optimistic-prompt-stuck-sending.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REFRESH_TIMEOUT_MS, reportRefresh } from "../model-refresh.js";

describe("reportRefresh — bounded wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves (undefined) once REFRESH_TIMEOUT_MS elapses on a never-settling refresh", async () => {
    const never = new Promise<never>(() => {});
    const pending = reportRefresh(never);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeUndefined();
    expect(settled).toBe(true);
  });

  it("still returns a fast refresh result untouched (non-regression)", async () => {
    const result = { aborted: false, errors: new Map<string, Error>() };
    await expect(reportRefresh(Promise.resolve(result))).resolves.toBe(result);
  });

  it("a late rejection of an abandoned refresh is swallowed, not unhandled", async () => {
    let reject!: (e: Error) => void;
    const pending = new Promise<never>((_r, rj) => {
      reject = rj;
    });
    const call = reportRefresh(pending);

    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS);
    await expect(call).resolves.toBeUndefined();

    reject(new Error("late boom"));
    await vi.advanceTimersByTimeAsync(0);
  });
});

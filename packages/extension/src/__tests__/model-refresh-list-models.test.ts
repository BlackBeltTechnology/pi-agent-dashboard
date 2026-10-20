/**
 * `resyncForListModels` — the bounded, never-rejecting resync `list_models`
 * runs before reading the registry, and `toRefreshErrors`.
 * See change: list-models-auto-resync (design D1; test-plan #P1, #P2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDERS_RESYNC_TIMEOUT_MS,
  REFRESH_TIMEOUT_MS,
  resyncForListModels,
  toRefreshErrors,
} from "../model-refresh.js";

const OK = { aborted: false, errors: new Map<string, Error>() };

describe("resyncForListModels — bounded waits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("P1: a never-settling providers re-apply is bounded by PROVIDERS_RESYNC_TIMEOUT_MS, then refresh runs", async () => {
    const refresh = vi.fn(async () => OK);
    let settled = false;
    const call = resyncForListModels({ refresh }, { reloadProviders: () => new Promise(() => {}) });
    const tracked = call.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(PROVIDERS_RESYNC_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    expect(refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(call).resolves.toBe(OK);
    await tracked;
    expect(settled).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("P2: a never-settling refresh resolves undefined after REFRESH_TIMEOUT_MS", async () => {
    const refresh = vi.fn(() => new Promise<never>(() => {}));
    let settled = false;
    const call = resyncForListModels({ refresh }, { reloadProviders: async () => {} });
    const tracked = call.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(call).resolves.toBeUndefined();
    await tracked;
    expect(settled).toBe(true);
  });
});

describe("toRefreshErrors", () => {
  it("maps provider errors to {provider,message}", () => {
    expect(toRefreshErrors({ aborted: false, errors: new Map([["flaky", new Error("down")]]) })).toEqual([
      { provider: "flaky", message: "down" },
    ]);
  });

  it("returns [] for an aborted result", () => {
    expect(toRefreshErrors({ aborted: true, errors: new Map([["x", new Error("e")]]) })).toEqual([]);
  });

  it("returns [] for an absent result", () => {
    expect(toRefreshErrors(undefined)).toEqual([]);
  });
});

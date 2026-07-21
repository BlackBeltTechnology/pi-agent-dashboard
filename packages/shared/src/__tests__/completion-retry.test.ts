import { describe, it, expect, vi } from "vitest";
import {
  isRetryableCompletionError,
  runWithRetry,
} from "../completion-retry.js";
import type { CompletionResult } from "../provider-completion-helpers.js";

describe("isRetryableCompletionError", () => {
  describe("retries transient HTTP statuses", () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      it(`status ${status} → retry`, () => {
        expect(isRetryableCompletionError({ status, error: `HTTP ${status}` })).toBe(true);
      });
    }
  });

  describe("does NOT retry terminal statuses", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      it(`status ${status} → no retry`, () => {
        expect(isRetryableCompletionError({ status, error: `HTTP ${status}` })).toBe(false);
      });
    }
  });

  describe("retries transient text categories (no status)", () => {
    const cases = [
      "fetch failed",
      "socket hang up",
      "ECONNRESET connection reset before headers",
      "timed out",
      "overloaded",
      "service unavailable",
      "This model is currently experiencing high demand",
      "upstream connect error",
    ];
    for (const s of cases) {
      it(`retries: ${s}`, () => {
        expect(isRetryableCompletionError({ error: s })).toBe(true);
      });
    }
  });

  describe("never retries terminal billing/quota even with retryable status", () => {
    const cases = [
      "insufficient_quota",
      "credit balance is too low",
      "usage_limit_reached",
      "monthly spending cap exceeded",
      "Your account does not have enough credits to use the Anthropic API",
      "You have 0 weighted tokens left",
      "Billing limit reached",
    ];
    for (const s of cases) {
      it(`429 + "${s}" → no retry`, () => {
        expect(isRetryableCompletionError({ status: 429, error: s })).toBe(false);
      });
    }
  });

  it("does not retry an unrecognized non-transient error", () => {
    expect(isRetryableCompletionError({ error: "Could not extract completion text" })).toBe(false);
  });
});

describe("runWithRetry", () => {
  const ok: CompletionResult = { ok: true, text: "hello" };
  const noSleep = () => Promise.resolve();

  it("returns immediately on first success (single call)", async () => {
    const fn = vi.fn<() => Promise<CompletionResult>>().mockResolvedValue(ok);
    const res = await runWithRetry(fn, { sleep: noSleep });
    expect(res).toEqual(ok);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 503 then succeeds", async () => {
    const fn = vi
      .fn<() => Promise<CompletionResult>>()
      .mockResolvedValueOnce({ ok: false, status: 503, error: "HTTP 503" })
      .mockResolvedValueOnce(ok);
    const res = await runWithRetry(fn, { sleep: noSleep });
    expect(res).toEqual(ok);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("stops after maxAttempts on persistent transient failure", async () => {
    const fail: CompletionResult = { ok: false, status: 503, error: "HTTP 503" };
    const fn = vi.fn<() => Promise<CompletionResult>>().mockResolvedValue(fail);
    const res = await runWithRetry(fn, { sleep: noSleep, maxAttempts: 3 });
    expect(res).toEqual(fail);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a terminal error (single call)", async () => {
    const fail: CompletionResult = { ok: false, status: 401, error: "unauthorized" };
    const fn = vi.fn<() => Promise<CompletionResult>>().mockResolvedValue(fail);
    const res = await runWithRetry(fn, { sleep: noSleep });
    expect(res).toEqual(fail);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a terminal billing limit even with 429", async () => {
    const fail: CompletionResult = { ok: false, status: 429, error: "insufficient_quota" };
    const fn = vi.fn<() => Promise<CompletionResult>>().mockResolvedValue(fail);
    const res = await runWithRetry(fn, { sleep: noSleep });
    expect(res).toEqual(fail);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses exponential backoff delays", async () => {
    const fail: CompletionResult = { ok: false, status: 503, error: "HTTP 503" };
    const fn = vi.fn<() => Promise<CompletionResult>>().mockResolvedValue(fail);
    const delays: number[] = [];
    const sleep = (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    };
    await runWithRetry(fn, { sleep, maxAttempts: 3, baseDelayMs: 100 });
    expect(delays).toEqual([100, 200]);
  });
});

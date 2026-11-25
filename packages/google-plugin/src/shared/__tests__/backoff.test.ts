/**
 * Retry policy values (scenario-gate B15 / C1 / C2; test-plan #GB15). See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import { isRetryable, MAX_ATTEMPTS, MAX_WAIT_MS, nextDelay, parseRetryAfter } from "../backoff.js";

describe("backoff policy", () => {
  it("3 attempts; 500 ms then 1 000 ms with up to 25 % jitter; capped", () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect(nextDelay(1, undefined, () => 0)).toEqual({ delayMs: 500 });
    expect(nextDelay(2, undefined, () => 0)).toEqual({ delayMs: 1000 });
    expect(nextDelay(1, undefined, () => 1)).toEqual({ delayMs: 625 });
    expect(nextDelay(20, undefined, () => 1)).toEqual({ delayMs: MAX_WAIT_MS });
  });
  it("Retry-After is honoured up to 30 s, beyond it the call fails (tooLong)", () => {
    expect(nextDelay(1, 7000)).toEqual({ delayMs: 7000 });
    expect(nextDelay(1, 30_000)).toEqual({ delayMs: 30_000 });
    expect(nextDelay(1, 30_001)).toEqual({ tooLong: true });
  });
  it("parses seconds and future HTTP dates; everything else is absent", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("7", now)).toBe(7000);
    expect(parseRetryAfter(" 3 ", now)).toBe(3000);
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:09 GMT", now)).toBe(9000);
    for (const v of ["0", "-1", "abc", "", null, undefined, "1.5", "12345678901", "Wed, 31 Dec 2025 23:00:00 GMT", "2026-01-01T00:00:09Z"]) {
      expect(parseRetryAfter(v, now), String(v)).toBeUndefined();
    }
  });
  it("429 retried for every method; 5xx / network only for GET, PUT, DELETE; other statuses never", () => {
    for (const m of ["GET", "POST", "PATCH", "PUT", "DELETE"]) expect(isRetryable(m, 429)).toBe(true);
    for (const m of ["GET", "PUT", "DELETE", "get"]) expect(isRetryable(m, 503)).toBe(true);
    for (const m of ["POST", "PATCH"]) {
      expect(isRetryable(m, 500)).toBe(false);
      expect(isRetryable(m, "network")).toBe(false);
    }
    for (const s of [400, 401, 403, 404, 409]) expect(isRetryable("GET", s)).toBe(false);
  });
});

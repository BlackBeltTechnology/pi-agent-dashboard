/**
 * Bounded retry policy for Google REST calls (scenario-gate B15 / C1 / C2): 3 attempts in total; without
 * `Retry-After` the waits are 500 ms, then 1 000 ms, each with up to 25 % jitter; a wait is never longer than
 * 30 s — a `Retry-After` beyond that fails at once as `rate_limited`. 429 is retried for every method; 5xx
 * only for idempotent ones (GET, PUT, DELETE) — a POST is never replayed after a 5xx (it may have landed).
 * Pure functions; the caller owns the timer. See change: add-google-connect.
 */
export const MAX_ATTEMPTS = 3;
export const BASE_DELAY_MS = 500;
export const MAX_WAIT_MS = 30_000;
const JITTER = 0.25;
const IDEMPOTENT = new Set(["GET", "PUT", "DELETE"]);

export const isIdempotent = (method: string): boolean => IDEMPOTENT.has(method.toUpperCase());

/** Whether this failed response / network error may be replayed (attempt budget not considered). */
export function isRetryable(method: string, status: number | "network"): boolean {
  if (status === 429) return true;
  if (status === "network" || status >= 500) return isIdempotent(method);
  return false;
}

/** `Retry-After` as milliseconds: delta-seconds or an HTTP-date in the future. Anything else (0, negative, junk, past) → undefined. */
export function parseRetryAfter(header: string | null | undefined, now: number = Date.now()): number | undefined {
  const v = header?.trim();
  if (!v) return undefined;
  if (/^\d{1,9}$/.test(v)) {
    const ms = Number(v) * 1000;
    return ms > 0 ? ms : undefined;
  }
  const at = /^[A-Za-z]{3},/.test(v) ? Date.parse(v) : Number.NaN;
  const ms = at - now;
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

/** The wait before attempt `failedAttempt + 1`, or `tooLong` when the server asks for more than the cap. */
export function nextDelay(
  failedAttempt: number,
  retryAfterMs: number | undefined,
  random: () => number = Math.random,
): { delayMs: number } | { tooLong: true } {
  if (retryAfterMs !== undefined) return retryAfterMs > MAX_WAIT_MS ? { tooLong: true } : { delayMs: retryAfterMs };
  const base = BASE_DELAY_MS * 2 ** (failedAttempt - 1);
  return { delayMs: Math.min(MAX_WAIT_MS, Math.round(base * (1 + JITTER * random()))) };
}

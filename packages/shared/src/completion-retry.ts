/**
 * Retry helper for one-shot LLM completions (translate path).
 *
 * The translate feature fires a single HTTP call against the chosen provider.
 * Providers like openrouter / 9router / opencode-go intermittently return
 * transient HTTP 503 "high demand", 429 rate-limit, or 5xx / network errors.
 * Without retry these surface as "Translation failed" even though a second
 * attempt would succeed.
 *
 * This wrapper retries a `CompletionResult`-returning function with
 * exponential backoff, but ONLY for transient categories. Terminal errors
 * (auth, bad request, quota/billing limits) are returned immediately so we
 * don't waste attempts on something that cannot recover.
 *
 * Shared by the server direct path (`completeWithProvider`) and the bridge
 * path (`handleTranslateRequest`) so retry behavior is identical regardless
 * of which provider type served the request.
 */

import { USAGE_LIMIT_PATTERN } from "./error-patterns.js";
import type { CompletionResult } from "./provider-completion-helpers.js";

/** HTTP status codes worth retrying — transient upstream / proxy failures. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Error-text categories that indicate a transient failure. Mirrors the
 * retry classifier pi-coding-agent uses internally (see
 * `packages/extension/src/retry-tracker.ts` RETRYABLE_PATTERN), minus the
 * bare status-code numbers (we classify status separately + numerically).
 */
const RETRYABLE_TEXT_PATTERN =
  /overloaded|provider.?returned.?error|rate.?limit|too many requests|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|http2 request did not get a response|timed? out|timeout|terminated|high demand|temporarily|try again/i;

/**
 * Decide whether a failed `CompletionResult` should be retried.
 *
 * Terminal billing/quota errors (USAGE_LIMIT_PATTERN) are never retried even
 * if their status is in the retryable set — a 429 that says "insufficient
 * quota" will not recover by waiting.
 */
export function isRetryableCompletionError(result: {
  status?: number;
  error?: string;
}): boolean {
  const error = result.error ?? "";

  // Terminal billing/quota — do not retry.
  if (USAGE_LIMIT_PATTERN.test(error)) return false;

  if (typeof result.status === "number" && RETRYABLE_STATUS.has(result.status)) {
    return true;
  }
  // No status (network-level failure) or non-retryable status → fall back to
  // text classification so "fetch failed" / "socket hang up" still retry.
  return RETRYABLE_TEXT_PATTERN.test(error);
}

export interface RetryOptions {
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Base backoff in ms; attempt N waits baseDelayMs * 2^(N-1). Default 400. */
  baseDelayMs?: number;
  /** Injectable sleep (tests). Default real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a completion function, retrying transient failures with exponential
 * backoff. Returns the last result (success or final failure). The function
 * is invoked at least once and at most `maxAttempts` times.
 */
export async function runWithRetry(
  fn: () => Promise<CompletionResult>,
  options: RetryOptions = {},
): Promise<CompletionResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 400;
  const sleep = options.sleep ?? defaultSleep;

  let last: CompletionResult = { ok: false, error: "no attempt made" };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await fn();
    if (last.ok) return last;
    if (attempt >= maxAttempts) break;
    if (!isRetryableCompletionError(last)) break;
    await sleep(baseDelayMs * 2 ** (attempt - 1));
  }
  return last;
}

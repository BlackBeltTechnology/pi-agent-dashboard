/**
 * Failed-authentication throttle for `/mcp`.
 *
 * `/mcp` is an authorization boundary reachable from outside the machine (over
 * a zrok tunnel), and it performs a credential comparison on every request. An
 * unthrottled endpoint of that shape lets an attacker spend the server's CPU
 * indefinitely at zero cost. CodeQL flags exactly this as `js/missing-rate-limiting`.
 *
 * Scope, deliberately narrow:
 *
 * - Only FAILED authentication is counted. A valid credential is never
 *   throttled, so a busy legitimate client (an MCP session driving a fleet)
 *   cannot be locked out by its own traffic. This is a brute-force control, not
 *   a quota.
 * - A success CLEARS the counter, so an operator who fixes a stale token
 *   recovers immediately rather than serving out a penalty.
 * - The tracking map is itself bounded. An unbounded per-IP map would trade a
 *   CPU-exhaustion vector for a memory-exhaustion one, which is a worse deal:
 *   the attacker picks the key space.
 *
 * A 256-bit opaque token is not realistically guessable, so this is defence in
 * depth rather than the primary control — the primary control is the token's
 * entropy.
 */

/** Failures allowed from one source before it is throttled. */
export const MAX_AUTH_FAILURES = 10;

/** Sliding window for those failures. */
export const AUTH_FAILURE_WINDOW_MS = 60_000;

/** How long a throttled source stays throttled. */
export const AUTH_LOCKOUT_MS = 60_000;

/**
 * Hard cap on tracked sources. Prevents the limiter from becoming a memory
 * amplifier when an attacker rotates source addresses.
 */
export const MAX_TRACKED_SOURCES = 10_000;

interface FailureRecord {
  count: number;
  /** Epoch ms of the first failure in the current window. */
  windowStart: number;
  /** Epoch ms until which the source is locked out, or 0. */
  lockedUntil: number;
}

export interface ThrottleDecision {
  allowed: boolean;
  /** Seconds to advertise in `Retry-After`, when throttled. */
  retryAfterSeconds: number;
}

export class AuthFailureThrottle {
  private readonly records = new Map<string, FailureRecord>();

  constructor(
    private readonly maxFailures = MAX_AUTH_FAILURES,
    private readonly windowMs = AUTH_FAILURE_WINDOW_MS,
    private readonly lockoutMs = AUTH_LOCKOUT_MS,
    private readonly maxSources = MAX_TRACKED_SOURCES,
  ) {}

  /** Tracked source count. Asserted by tests as the memory-bound canary. */
  get size(): number {
    return this.records.size;
  }

  /** Whether `source` may attempt authentication now. */
  check(source: string, now = Date.now()): ThrottleDecision {
    const record = this.records.get(source);
    if (!record) return { allowed: true, retryAfterSeconds: 0 };

    if (record.lockedUntil > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((record.lockedUntil - now) / 1000),
      };
    }

    // Lockout expired — drop the record so a reformed source starts clean
    // rather than sitting one failure away from another lockout.
    if (record.lockedUntil !== 0) {
      this.records.delete(source);
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Record a failed authentication. */
  recordFailure(source: string, now = Date.now()): void {
    const existing = this.records.get(source);

    if (!existing) {
      this.evictIfFull();
      this.records.set(source, { count: 1, windowStart: now, lockedUntil: 0 });
      return;
    }

    // Window expired — start a new one rather than accumulating forever, so
    // occasional failures spread over hours never trip the limit.
    if (now - existing.windowStart >= this.windowMs) {
      existing.count = 1;
      existing.windowStart = now;
      existing.lockedUntil = 0;
      return;
    }

    existing.count += 1;
    if (existing.count >= this.maxFailures) {
      existing.lockedUntil = now + this.lockoutMs;
    }
  }

  /** Record a success, clearing any accumulated failures for that source. */
  recordSuccess(source: string): void {
    this.records.delete(source);
  }

  /**
   * Make room when at capacity by dropping the oldest entry.
   *
   * `Map` preserves insertion order, so the first key is the oldest tracked
   * source. Evicting it can drop an active lockout, which is the accepted
   * trade: bounding memory matters more than perfectly retaining one
   * attacker's penalty, and reaching this cap already means the source space is
   * being rotated (so per-source lockout is not the effective control anyway).
   */
  private evictIfFull(): void {
    if (this.records.size < this.maxSources) return;
    const oldest = this.records.keys().next();
    if (!oldest.done) this.records.delete(oldest.value);
  }

  /** Drop all state (plugin unload). */
  clear(): void {
    this.records.clear();
  }
}

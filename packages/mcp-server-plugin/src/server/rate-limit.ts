/**
 * Failed-authentication throttle for `/mcp`, keyed on
 * `(ip, credential fingerprint)` with a coarser per-ip ceiling (design.md D7).
 *
 * `/mcp` is an authorization boundary reachable from outside the machine (over
 * a zrok tunnel), and it performs a credential comparison on every request. An
 * unthrottled endpoint of that shape lets an attacker spend the server's CPU
 * indefinitely at zero cost. CodeQL flags exactly this as `js/missing-rate-limiting`.
 *
 * TWO key dimensions, because every local pi session shares `127.0.0.1`:
 *
 * - Per `(ip, fingerprint)` bucket at `MAX_AUTH_FAILURES`: one session
 *   repeatedly presenting one stale token exhausts only its own bucket and
 *   never denies the other local sessions holding valid ones (Req: "One
 *   session's credential failures do not lock out the others").
 * - Per-`ip` ceiling at `MAX_IP_AUTH_FAILURES`: an attacker rotating
 *   credentials creates a fresh bucket per guess, so the fine-grained bucket
 *   alone would never trip; the ceiling catches the rotation.
 *
 * Scope, deliberately narrow:
 *
 * - Only FAILED authentication is counted. A valid credential is never
 *   throttled, so a busy legitimate client (an MCP session driving a fleet)
 *   cannot be locked out by its own traffic. This is a brute-force control, not
 *   a quota.
 * - A success CLEARS both counters, so an operator who fixes a stale token
 *   recovers immediately rather than serving out a penalty.
 * - Both tracking maps are bounded. An unbounded map would trade a
 *   CPU-exhaustion vector for a memory-exhaustion one, which is a worse deal:
 *   the attacker picks the key space. The maps are SEPARATE, so fingerprint
 *   churn evicts only fingerprint buckets and can never drop a per-ip ceiling
 *   record (P3).
 *
 * A 256-bit opaque token is not realistically guessable, so this is defence in
 * depth rather than the primary control — the primary control is the token's
 * entropy. The fingerprint is a SHA-256 digest and is never logged (X6).
 */

/** Failures allowed from one source before it is throttled. */
export const MAX_AUTH_FAILURES = 10;

/**
 * Coarser per-ip ceiling (design.md D7, planning gate decision): 10× the
 * per-credential bucket. A brute-forcer rotating credentials creates a new
 * per-credential bucket per guess but walks into this ceiling.
 */
export const MAX_IP_AUTH_FAILURES = 100;

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

/** Per-credential bucket key: the ip and the hex fingerprint cannot collide. */
function credentialKey(ip: string, fingerprint: string): string {
  return `${ip}\u0000${fingerprint}`;
}

export class AuthFailureThrottle {
  /**
   * Per-`(ip, fingerprint)` buckets. Keyed by `ip + NUL + fingerprint` — the
   * fingerprint is a hex SHA-256 digest, but the separator keeps an ip and a
   * fingerprint from bleeding into each other.
   */
  private readonly perCredential = new Map<string, FailureRecord>();

  /** Coarse per-ip ceiling buckets. Keyed by ip alone. */
  private readonly perIp = new Map<string, FailureRecord>();

  constructor(
    private readonly maxFailures = MAX_AUTH_FAILURES,
    private readonly windowMs = AUTH_FAILURE_WINDOW_MS,
    private readonly lockoutMs = AUTH_LOCKOUT_MS,
    private readonly maxSources = MAX_TRACKED_SOURCES,
    private readonly maxIpFailures = MAX_IP_AUTH_FAILURES,
  ) {}

  /** Tracked per-credential bucket count. Asserted by tests as the memory-bound canary. */
  get size(): number {
    return this.perCredential.size;
  }

  /** Tracked per-ip bucket count. P3 asserts fingerprint churn leaves it intact. */
  get ipSources(): number {
    return this.perIp.size;
  }

  /** Whether `(ip, fingerprint)` may attempt authentication now. */
  check(ip: string, fingerprint: string, now = Date.now()): ThrottleDecision {
    const credential = this.perCredential.get(credentialKey(ip, fingerprint));
    const ceiling = this.perIp.get(ip);
    const blocked = [credential, ceiling].find(
      (record) => record !== undefined && record.lockedUntil > now,
    );
    if (blocked !== undefined) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((blocked.lockedUntil - now) / 1000),
      };
    }

    // A lockout that has expired drops the record, so a reformed source starts
    // clean rather than sitting one failure away from another lockout.
    for (const [map, key, record] of [
      [this.perCredential, credentialKey(ip, fingerprint), credential],
      [this.perIp, ip, ceiling],
    ] as const) {
      if (record !== undefined && record.lockedUntil !== 0) map.delete(key);
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Record a failed authentication against both buckets. */
  recordFailure(ip: string, fingerprint: string, now = Date.now()): void {
    this.bump(this.perCredential, credentialKey(ip, fingerprint), this.maxFailures, this.maxSources, now);
    // The per-ip map's CAPACITY is maxSources (it grows with distinct ips),
    // while its FAILURE threshold is the coarser ceiling.
    this.bump(this.perIp, ip, this.maxIpFailures, this.maxSources, now);
  }

  /** Record a success, clearing any accumulated failures for both buckets. */
  recordSuccess(ip: string, fingerprint: string): void {
    this.perCredential.delete(credentialKey(ip, fingerprint));
    this.perIp.delete(ip);
  }

  /**
   * Advance one bucket's window/lockout state, evicting the oldest entry when
   * at capacity (shared by both maps — each is bounded independently).
   *
   * `Map` preserves insertion order, so the first key is the oldest tracked
   * source. Evicting it can drop an active lockout, which is the accepted
   * trade: bounding memory matters more than perfectly retaining one
   * attacker's penalty, and reaching this cap already means the source space is
   * being rotated (so per-source lockout is not the effective control anyway).
   */
  private bump(
    map: Map<string, FailureRecord>,
    key: string,
    threshold: number,
    maxEntries: number,
    now: number,
  ): void {
    const existing = map.get(key);

    if (!existing) {
      if (map.size >= maxEntries) {
        const oldest = map.keys().next();
        if (!oldest.done) map.delete(oldest.value);
      }
      map.set(key, { count: 1, windowStart: now, lockedUntil: 0 });
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
    if (existing.count >= threshold) {
      existing.lockedUntil = now + this.lockoutMs;
    }
  }

  /** Drop all state (plugin unload). */
  clear(): void {
    this.perCredential.clear();
    this.perIp.clear();
  }
}

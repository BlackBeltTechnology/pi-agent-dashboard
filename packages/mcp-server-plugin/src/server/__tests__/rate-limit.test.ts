/**
 * Failed-authentication throttle, keyed on `(ip, credential fingerprint)` with
 * a coarser per-ip ceiling (wire-mcp-session-token design D7).
 *
 * Two reasons this module exists:
 *
 * - CodeQL `js/missing-rate-limiting`: `/mcp` is an authorization boundary
 *   reachable over a tunnel and runs a credential comparison on every request,
 *   so an unthrottled endpoint lets an attacker spend server CPU for free.
 * - Every local pi session shares `127.0.0.1`, so the old ip-only key treated
 *   them as ONE source: one session's stale token throttled all the others.
 *
 * The tests assert BOTH directions: that an attacker is stopped (per-credential
 * bucket AND the rotation-resistant per-ip ceiling), and that legitimate
 * traffic is never affected — a throttle that locks out real users is a
 * self-inflicted outage.
 */
import { describe, expect, it, vi } from "vitest";
import {
  AUTH_FAILURE_WINDOW_MS,
  AuthFailureThrottle,
  MAX_AUTH_FAILURES,
  MAX_IP_AUTH_FAILURES,
  MAX_TRACKED_SOURCES,
} from "../rate-limit.js";

const IP = "127.0.0.1";

function fp(n: number): string {
  return `fingerprint-${String(n).padStart(4, "0")}`;
}

describe("E6 — the per-credential bucket still blocks brute force", () => {
  it("allows attempts up to the limit, then throttles (9 → 401, 10 → 429)", () => {
    const t = new AuthFailureThrottle();
    const now = 1_000_000;

    for (let i = 0; i < MAX_AUTH_FAILURES - 1; i += 1) {
      t.recordFailure(IP, fp(1), now);
      // At 9 failures the next attempt still REACHES authentication.
      expect(t.check(IP, fp(1), now).allowed).toBe(true);
    }

    t.recordFailure(IP, fp(1), now);
    expect(t.check(IP, fp(1), now).allowed).toBe(false);
  });

  it("advertises Retry-After ≈ 60 while locked out", () => {
    const t = new AuthFailureThrottle();
    const now = 1_000_000;
    for (let i = 0; i < MAX_AUTH_FAILURES; i += 1) t.recordFailure(IP, fp(1), now);

    const verdict = t.check(IP, fp(1), now);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
    expect(verdict.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("releases the lockout once it expires", () => {
    const t = new AuthFailureThrottle();
    const now = 1_000_000;
    for (let i = 0; i < MAX_AUTH_FAILURES; i += 1) t.recordFailure(IP, fp(1), now);
    expect(t.check(IP, fp(1), now).allowed).toBe(false);

    expect(t.check(IP, fp(1), now + 61_000).allowed).toBe(true);
  });

  it("headerless requests share one fingerprint bucket (fingerprint of absent = stable)", () => {
    // routes.ts fingerprints the empty string when no bearer is presented, so
    // a headerless flood is bounded by the same per-credential bucket.
    const t = new AuthFailureThrottle();
    const now = 1_000_000;
    for (let i = 0; i < MAX_AUTH_FAILURES; i += 1) t.recordFailure(IP, "no-credential", now);
    expect(t.check(IP, "no-credential", now).allowed).toBe(false);
  });
});

describe("E7 — the per-ip ceiling catches credential rotation", () => {
  it("at 99 rotated failures a request still reaches auth; at 100 it is throttled", () => {
    const t = new AuthFailureThrottle();
    const now = 1_000_000;

    for (let i = 0; i < MAX_IP_AUTH_FAILURES - 1; i += 1) {
      t.recordFailure(IP, fp(i), now); // fresh fingerprint per guess
    }
    // Every individual bucket is nearly empty, and the 100th attempt still
    // REACHES authentication.
    expect(t.check(IP, fp(999), now).allowed).toBe(true);

    t.recordFailure(IP, fp(999), now);
    // 429 despite an empty bucket for THIS fingerprint — the ceiling fired.
    expect(t.check(IP, fp(12345), now).allowed).toBe(false);
  });

  it("the ceiling is 10x the per-credential bucket (planning gate decision)", () => {
    expect(MAX_IP_AUTH_FAILURES).toBe(MAX_AUTH_FAILURES * 10);
  });

  it("a DIFFERENT ip is never affected by one ip's ceiling", () => {
    const t = new AuthFailureThrottle();
    const now = 1_000_000;
    for (let i = 0; i < MAX_IP_AUTH_FAILURES; i += 1) t.recordFailure(IP, fp(i), now);

    expect(t.check("5.6.7.8", fp(1), now).allowed).toBe(true);
    expect(t.check(IP, fp(1), now).allowed).toBe(false);
  });

  it("the ceiling expires like the bucket does", () => {
    const t = new AuthFailureThrottle();
    const now = 1_000_000;
    for (let i = 0; i < MAX_IP_AUTH_FAILURES; i += 1) t.recordFailure(IP, fp(i), now);
    expect(t.check(IP, fp(50000), now).allowed).toBe(false);
    expect(t.check(IP, fp(50000), now + 61_000).allowed).toBe(true);
  });
});

describe("E8 — one source's lockout never denies the others", () => {
  it("A locked out on F1; B's distinct valid credential still passes from the same ip", () => {
    const t = new AuthFailureThrottle();
    const now = 1_000_000;
    // Session A repeatedly presents its stale token F1 past the threshold.
    for (let i = 0; i < MAX_AUTH_FAILURES; i += 1) t.recordFailure(IP, fp(1), now);
    expect(t.check(IP, fp(1), now).allowed).toBe(false);

    // Session B holds a valid token — its fingerprint was never recorded.
    expect(t.check(IP, fp(2), now).allowed).toBe(true);

    // B's successful traffic does not lift A's lockout either...
    t.recordSuccess(IP, fp(2));
    expect(t.check(IP, fp(1), now).allowed).toBe(false);
  });

  it("a success clears BOTH buckets, so a fixed credential recovers immediately", () => {
    const t = new AuthFailureThrottle();
    const now = 1_000_000;
    for (let i = 0; i < MAX_AUTH_FAILURES - 1; i += 1) t.recordFailure(IP, fp(1), now);

    t.recordSuccess(IP, fp(1));

    // One more failure must NOT trip the limit, because the count reset.
    t.recordFailure(IP, fp(1), now);
    expect(t.check(IP, fp(1), now).allowed).toBe(true);
  });

  it("a success also clears the per-ip ceiling accumulated by that ip's failures", () => {
    const t = new AuthFailureThrottle();
    const now = 1_000_000;
    for (let i = 0; i < MAX_IP_AUTH_FAILURES - 1; i += 1) t.recordFailure(IP, fp(i), now);
    t.recordSuccess(IP, fp(0));
    t.recordFailure(IP, fp(999), now);
    // The ceiling counter restarted at 1, so the ip is not one failure away.
    expect(t.check(IP, fp(998), now).allowed).toBe(true);
  });

  it("a source that never fails is never tracked at all", () => {
    const t = new AuthFailureThrottle();
    for (let i = 0; i < 1000; i += 1) t.recordSuccess(IP, fp(1));
    expect(t.size).toBe(0);
    expect(t.ipSources).toBe(0);
    expect(t.check(IP, fp(1)).allowed).toBe(true);
  });

  it("failures spread beyond the window never accumulate to a lockout", () => {
    const t = new AuthFailureThrottle();
    let now = 1_000_000;
    // Far more than the limit, but each outside the previous window.
    for (let i = 0; i < MAX_AUTH_FAILURES * 3; i += 1) {
      t.recordFailure(IP, fp(1), now);
      expect(t.check(IP, fp(1), now).allowed).toBe(true);
      now += AUTH_FAILURE_WINDOW_MS + 1;
    }
  });
});

describe("P3 — bounded under fingerprint churn (memory amplification)", () => {
  it("caps tracked fingerprints while the per-ip ceiling record is never evicted", () => {
    const t = new AuthFailureThrottle();
    const now = 1_000_000;
    for (let i = 0; i < 20_000; i += 1) t.recordFailure(IP, `fp-${i}`, now);

    expect(t.size).toBeLessThanOrEqual(MAX_TRACKED_SOURCES);
    // Fingerprint churn evicts fingerprint buckets, never the ceiling record.
    expect(t.ipSources).toBe(1);
    expect(t.check(IP, "fp-anything", now).allowed).toBe(false);
  });

  it("caps the number of tracked sources with a small explicit budget", () => {
    const t = new AuthFailureThrottle(10, 60_000, 60_000, 50);
    for (let i = 0; i < 5000; i += 1) t.recordFailure(`10.0.${i % 256}.${i % 251}`, fp(1));
    expect(t.size).toBeLessThanOrEqual(50);
  });

  it("keeps working correctly after eviction pressure", () => {
    const t = new AuthFailureThrottle(3, 60_000, 60_000, 5);
    const now = 1_000_000;
    for (let i = 0; i < 100; i += 1) t.recordFailure(`src-${i}`, fp(1), now);

    // A fresh source still throttles properly despite churn.
    for (let i = 0; i < 3; i += 1) t.recordFailure("attacker", fp(1), now);
    expect(t.check("attacker", fp(1), now).allowed).toBe(false);
    expect(t.size).toBeLessThanOrEqual(5);
  });

  it("clear() drops all state", () => {
    const t = new AuthFailureThrottle();
    for (let i = 0; i < 20; i += 1) t.recordFailure(`src-${i}`, fp(1));
    expect(t.size).toBeGreaterThan(0);
    t.clear();
    expect(t.size).toBe(0);
    expect(t.ipSources).toBe(0);
  });
});

describe("X6 — the fingerprint never reaches an observable log line", () => {
  it("recording failures, lockouts and checks emits nothing to any console sink", () => {
    const sinks = ["log", "info", "warn", "error", "debug"] as const;
    const spies = Object.fromEntries(sinks.map((s) => [s, vi.spyOn(console, s).mockImplementation(() => {})]));
    try {
      const t = new AuthFailureThrottle();
      const now = 1_000_000;
      const secretFingerprint = "sha256-of-a-live-credential";
      for (let i = 0; i < MAX_AUTH_FAILURES; i += 1) t.recordFailure(IP, secretFingerprint, now);
      // The lockout is active, an expiry check happens, and a success clears.
      expect(t.check(IP, secretFingerprint, now).allowed).toBe(false);
      t.recordSuccess(IP, secretFingerprint);

      for (const s of sinks) expect(spies[s]).not.toHaveBeenCalled();
    } finally {
      for (const s of sinks) spies[s].mockRestore();
    }
  });
});

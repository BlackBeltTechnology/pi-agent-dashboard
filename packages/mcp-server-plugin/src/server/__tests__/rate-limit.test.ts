/**
 * Failed-authentication throttle.
 *
 * Added for CodeQL `js/missing-rate-limiting`: `/mcp` is an authorization
 * boundary reachable over a tunnel and runs a credential comparison on every
 * request, so an unthrottled endpoint lets an attacker spend server CPU for
 * free.
 *
 * The tests assert BOTH directions: that an attacker is stopped, and that
 * legitimate traffic is never affected — a throttle that locks out real users
 * is a self-inflicted outage.
 */
import { describe, expect, it } from "vitest";
import {
  AUTH_FAILURE_WINDOW_MS,
  AuthFailureThrottle,
  MAX_AUTH_FAILURES,
} from "../rate-limit.js";

describe("blocks brute force", () => {
  it("allows attempts up to the limit, then throttles", () => {
    const t = new AuthFailureThrottle();
    const now = 1_000_000;

    for (let i = 0; i < MAX_AUTH_FAILURES - 1; i += 1) {
      t.recordFailure("1.2.3.4", now);
      expect(t.check("1.2.3.4", now).allowed).toBe(true);
    }

    t.recordFailure("1.2.3.4", now);
    expect(t.check("1.2.3.4", now).allowed).toBe(false);
  });

  it("advertises a positive Retry-After while locked out", () => {
    const t = new AuthFailureThrottle();
    const now = 1_000_000;
    for (let i = 0; i < MAX_AUTH_FAILURES; i += 1) t.recordFailure("1.2.3.4", now);

    const verdict = t.check("1.2.3.4", now);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("releases the lockout once it expires", () => {
    const t = new AuthFailureThrottle();
    const now = 1_000_000;
    for (let i = 0; i < MAX_AUTH_FAILURES; i += 1) t.recordFailure("1.2.3.4", now);
    expect(t.check("1.2.3.4", now).allowed).toBe(false);

    expect(t.check("1.2.3.4", now + 61_000).allowed).toBe(true);
  });

  it("throttles per source — one attacker does not lock out everyone", () => {
    const t = new AuthFailureThrottle();
    const now = 1_000_000;
    for (let i = 0; i < MAX_AUTH_FAILURES; i += 1) t.recordFailure("1.2.3.4", now);

    expect(t.check("1.2.3.4", now).allowed).toBe(false);
    expect(t.check("5.6.7.8", now).allowed).toBe(true);
  });
});

describe("never penalises legitimate traffic", () => {
  it("a success clears accumulated failures immediately", () => {
    const t = new AuthFailureThrottle();
    const now = 1_000_000;
    for (let i = 0; i < MAX_AUTH_FAILURES - 1; i += 1) t.recordFailure("1.2.3.4", now);

    t.recordSuccess("1.2.3.4");

    // One more failure must NOT trip the limit, because the count reset.
    t.recordFailure("1.2.3.4", now);
    expect(t.check("1.2.3.4", now).allowed).toBe(true);
  });

  it("a source that never fails is never tracked at all", () => {
    const t = new AuthFailureThrottle();
    for (let i = 0; i < 1000; i += 1) t.recordSuccess("1.2.3.4");
    expect(t.size).toBe(0);
    expect(t.check("1.2.3.4").allowed).toBe(true);
  });

  it("failures spread beyond the window never accumulate to a lockout", () => {
    const t = new AuthFailureThrottle();
    let now = 1_000_000;
    // Far more than the limit, but each outside the previous window.
    for (let i = 0; i < MAX_AUTH_FAILURES * 3; i += 1) {
      t.recordFailure("1.2.3.4", now);
      expect(t.check("1.2.3.4", now).allowed).toBe(true);
      now += AUTH_FAILURE_WINDOW_MS + 1;
    }
  });
});

describe("is itself bounded (does not become a memory amplifier)", () => {
  it("caps the number of tracked sources", () => {
    const t = new AuthFailureThrottle(10, 60_000, 60_000, 50);
    for (let i = 0; i < 5000; i += 1) t.recordFailure(`10.0.${i % 256}.${i % 251}`);
    expect(t.size).toBeLessThanOrEqual(50);
  });

  it("keeps working correctly after eviction pressure", () => {
    const t = new AuthFailureThrottle(3, 60_000, 60_000, 5);
    const now = 1_000_000;
    for (let i = 0; i < 100; i += 1) t.recordFailure(`src-${i}`, now);

    // A fresh source still throttles properly despite churn.
    for (let i = 0; i < 3; i += 1) t.recordFailure("attacker", now);
    expect(t.check("attacker", now).allowed).toBe(false);
    expect(t.size).toBeLessThanOrEqual(5);
  });

  it("clear() drops all state", () => {
    const t = new AuthFailureThrottle();
    for (let i = 0; i < 20; i += 1) t.recordFailure(`src-${i}`);
    expect(t.size).toBeGreaterThan(0);
    t.clear();
    expect(t.size).toBe(0);
  });
});

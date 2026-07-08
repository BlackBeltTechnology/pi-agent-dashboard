import { describe, it, expect } from "vitest";
import { UsageLimitOrderer, USAGE_LIMIT_PATTERN } from "../usage-limit-orderer.js";
import { USAGE_LIMIT_FIXTURES, NON_USAGE_LIMIT_FIXTURES } from "./fixtures/usage-limit-error-strings.js";

describe("UsageLimitOrderer", () => {
  it("returns null when no retry was pending", () => {
    const o = new UsageLimitOrderer();
    const result = o.maybeSynthesize("s1", {
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "usage_limit_reached" }],
    });
    expect(result).toBeNull();
  });

  it("returns null when retry was pending but error is not a usage-limit", () => {
    const o = new UsageLimitOrderer();
    o.noteRetryStart("s1");
    const result = o.maybeSynthesize("s1", {
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "tool execution failed" }],
    });
    expect(result).toBeNull();
  });

  it("returns null on a non-error agent_end even with pending retry", () => {
    const o = new UsageLimitOrderer();
    o.noteRetryStart("s1");
    const result = o.maybeSynthesize("s1", {
      messages: [{ role: "assistant", stopReason: "end_turn" }],
    });
    expect(result).toBeNull();
  });

  it("synthesizes auto_retry_end on usage_limit_reached when retry was pending", () => {
    const o = new UsageLimitOrderer();
    o.noteRetryStart("s1");
    const result = o.maybeSynthesize("s1", {
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "usage_limit_reached: 5000 RPM" }],
    });
    expect(result).not.toBeNull();
    expect(result!.eventType).toBe("auto_retry_end");
    expect(result!.data).toEqual({ success: false, attempt: -1, finalError: "usage_limit_reached: 5000 RPM" });
  });

  it.each([
    "usage_limit_reached",
    "usage_not_included",
    "quota_exceeded",
    "monthly limit reached for free tier",
    "hourly limit hit",
    "Your quota will reset after 18h31m10s",
  ])("matches usage-limit variant: %s", (msg) => {
    expect(USAGE_LIMIT_PATTERN.test(msg)).toBe(true);
  });

  it.each([
    "rate limit exceeded",
    "overloaded_error",
    "tool execution failed",
    "fetch failed",
    "",
  ])("does not match non-usage-limit variant: %s", (msg) => {
    expect(USAGE_LIMIT_PATTERN.test(msg)).toBe(false);
  });

  // Real production-log fixtures — see change: fix-retry-banner-stuck-on-limit-exceeded.
  describe("USAGE_LIMIT_PATTERN broadened coverage (production fixtures)", () => {
    it.each(USAGE_LIMIT_FIXTURES)("matches terminal: [$provider] $label", ({ error }) => {
      expect(USAGE_LIMIT_PATTERN.test(error)).toBe(true);
    });

    it.each(NON_USAGE_LIMIT_FIXTURES)("does not match transient: [$provider] $label", ({ error }) => {
      expect(USAGE_LIMIT_PATTERN.test(error)).toBe(false);
    });
  });

  it("clears pending after agent_end (no double-synthesis on subsequent agent_end)", () => {
    const o = new UsageLimitOrderer();
    o.noteRetryStart("s1");
    const first = o.maybeSynthesize("s1", {
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "usage_limit_reached" }],
    });
    expect(first).not.toBeNull();
    // Same payload again — pending was cleared, so no synthesis.
    const second = o.maybeSynthesize("s1", {
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "usage_limit_reached" }],
    });
    expect(second).toBeNull();
  });

  it("noteRetryEnd clears pending so subsequent agent_end does not synthesize", () => {
    const o = new UsageLimitOrderer();
    o.noteRetryStart("s1");
    o.noteRetryEnd("s1");
    expect(o.hasPending("s1")).toBe(false);
    const result = o.maybeSynthesize("s1", {
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "usage_limit_reached" }],
    });
    expect(result).toBeNull();
  });

  it("scopes pending state per-session", () => {
    const o = new UsageLimitOrderer();
    o.noteRetryStart("s1");
    expect(o.hasPending("s2")).toBe(false);
    const result = o.maybeSynthesize("s2", {
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "usage_limit_reached" }],
    });
    expect(result).toBeNull();
  });

  it("returns null on missing or empty messages array", () => {
    const o = new UsageLimitOrderer();
    o.noteRetryStart("s1");
    expect(o.maybeSynthesize("s1", {})).toBeNull();
    o.noteRetryStart("s1");
    expect(o.maybeSynthesize("s1", { messages: [] })).toBeNull();
  });
});

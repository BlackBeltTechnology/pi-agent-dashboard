import { describe, it, expect } from "vitest";
import { USAGE_LIMIT_PATTERN } from "../error-patterns.js";

describe("USAGE_LIMIT_PATTERN", () => {
  describe("matches documented terminal billing/quota categories", () => {
    const cases: string[] = [
      "usage_limit_reached",
      "usage limit reached",
      "usage_not_included",
      "insufficient_quota",
      "credit balance",
      "credit_balance is too low",
      "quota_exceeded",
      "quota exceeded for this minute",
      "resource_exhausted",
      "RESOURCE_EXHAUSTED",
      "monthly_limit",
      "monthly limit",
      "monthly_spending_cap",
      "monthly spending cap exceeded",
      "hourly_limit",
      "daily_limit",
      "spending_cap",
      "spending cap",
      "reset after 12h",
      "reset after 45m",
      "reset after 30s",
      "Your project has exceeded its monthly spending cap",
      "Anthropic: Your credit balance is too low to access the API",
      "OpenAI: insufficient_quota for organization X",
      "Gemini RESOURCE_EXHAUSTED: usage_limit_reached",
    ];
    for (const s of cases) {
      it(`matches: ${s}`, () => {
        expect(USAGE_LIMIT_PATTERN.test(s)).toBe(true);
      });
    }
  });

  describe("does NOT match generic retryable / non-terminal errors", () => {
    const cases: string[] = [
      "fetch failed",
      "ECONNRESET",
      "socket hang up",
      "timeout",
      "timed out",
      "429 Too Many Requests",
      "rate limit exceeded; try again",
      "503 Service Unavailable",
      "network error",
      "connection refused",
      "overloaded",
      "internal server error",
      "tool execution failed",
      "file not found",
    ];
    for (const s of cases) {
      it(`does not match: ${s}`, () => {
        expect(USAGE_LIMIT_PATTERN.test(s)).toBe(false);
      });
    }
  });

  it("re-export from packages/extension/src/usage-limit-orderer matches shared source", async () => {
    // Cross-validate the re-export to catch silent drift.
    const fromExtension = (await import("../../../extension/src/usage-limit-orderer.js")).USAGE_LIMIT_PATTERN;
    expect(fromExtension.source).toBe(USAGE_LIMIT_PATTERN.source);
    expect(fromExtension.flags).toBe(USAGE_LIMIT_PATTERN.flags);
  });
});

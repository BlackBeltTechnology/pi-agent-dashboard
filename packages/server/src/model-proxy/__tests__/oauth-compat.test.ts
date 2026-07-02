/**
 * Tests for the OAuth-incompatible override table.
 *
 * See change: filter-oauth-incompatible-models, task 1.3.
 */
import { describe, expect, it } from "vitest";
import { isOauthIncompatible, OAUTH_INCOMPATIBLE } from "../oauth-compat.js";

describe("isOauthIncompatible", () => {
  it("returns true for a known OAuth-incompatible id", () => {
    expect(isOauthIncompatible("anthropic", "claude-3-5-haiku-20241022")).toBe(true);
  });

  it("returns false for a known provider with an unknown id", () => {
    expect(isOauthIncompatible("anthropic", "claude-haiku-4-5")).toBe(false);
  });

  it("returns false for an unknown provider", () => {
    expect(isOauthIncompatible("openai", "gpt-4o")).toBe(false);
  });

  it("matches ids case-sensitively", () => {
    expect(isOauthIncompatible("anthropic", "CLAUDE-3-5-HAIKU-20241022")).toBe(false);
  });

  it("flags every legacy Anthropic snapshot in the table", () => {
    for (const id of OAUTH_INCOMPATIBLE.anthropic) {
      expect(isOauthIncompatible("anthropic", id)).toBe(true);
    }
  });
});

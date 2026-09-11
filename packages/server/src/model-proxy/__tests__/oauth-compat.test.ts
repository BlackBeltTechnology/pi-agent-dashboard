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

  // E10 (change: update-pi-core-0-85-adopt-apis): the table lists ONLY pre-4.x
  // snapshots. The fable 5.1 HTTP 400 was a client-version (user-agent) header
  // gate, NOT a catalog gate — adding it here would wrongly hide a model that
  // IS reachable on 0.85.1, and the change explicitly forbids it.
  it("E10: contains only pre-4.x snapshots; claude-fable-5-1 is absent", () => {
    expect(OAUTH_INCOMPATIBLE.anthropic.has("claude-fable-5-1")).toBe(false);
    expect(OAUTH_INCOMPATIBLE.anthropic.has("claude-fable-5")).toBe(false);
    for (const id of OAUTH_INCOMPATIBLE.anthropic) {
      expect(id, `${id} must be a pre-4.x claude-3 snapshot`).toMatch(/^claude-3/);
    }
    // No Codex/OpenAI OAuth-incompat entries exist — the Codex channel is
    // routed by provider equality, not by this table.
    expect(OAUTH_INCOMPATIBLE.openai).toBeUndefined();
    expect(OAUTH_INCOMPATIBLE["openai-codex"]).toBeUndefined();
  });
});

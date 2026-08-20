/**
 * Model resolution tests. See change: add-automation-plugin.
 */
import { describe, it, expect } from "vitest";
import { resolveModel } from "../server/model-resolver.js";

const roles = () => ({ fast: "anthropic/claude-haiku-4-5", deep: "openai/gpt-5" });

describe("resolveModel", () => {
  it("passes a bare provider/model id through unchanged", () => {
    const r = resolveModel("anthropic/claude-sonnet-4-5", { readRoles: roles });
    expect(r).toEqual({ model: "anthropic/claude-sonnet-4-5" });
  });

  // A thinking suffix rides the ref; the resolver must not inspect or strip it
  // (no server-side change for add-default-thinking-level, design D8).
  it("passes a thinking-suffixed ref through unchanged", () => {
    const r = resolveModel("anthropic/claude-sonnet-4-5:high", { readRoles: roles });
    expect(r).toEqual({ model: "anthropic/claude-sonnet-4-5:high" });
  });

  it("returns a role's suffixed ref verbatim", () => {
    const r = resolveModel("@fast", { readRoles: () => ({ fast: "anthropic/claude-haiku-4-5:low" }) });
    expect(r.model).toBe("anthropic/claude-haiku-4-5:low");
    expect(r.error).toBeUndefined();
  });

  it("resolves an @role to its concrete model", () => {
    const r = resolveModel("@fast", { readRoles: roles });
    expect(r.model).toBe("anthropic/claude-haiku-4-5");
    expect(r.error).toBeUndefined();
  });

  it("falls back to the default model + error when role is unresolved", () => {
    const r = resolveModel("@gone", { readRoles: roles, defaultModel: "anthropic/claude-sonnet-4-5" });
    expect(r.model).toBe("anthropic/claude-sonnet-4-5");
    expect(r.error).toContain("@gone");
  });

  it("surfaces an error with empty model when no default configured", () => {
    const r = resolveModel("@gone", { readRoles: roles });
    expect(r.model).toBe("");
    expect(r.error).toContain("no default model");
  });
});

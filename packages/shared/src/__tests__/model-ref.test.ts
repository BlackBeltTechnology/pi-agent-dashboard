import { describe, expect, it } from "vitest";
import { parseModelRef, resolveModelRef, THINKING_LEVELS } from "../role-schema.js";
import type { RoleConfig } from "../role-schema.js";

const cfg = (roles: Record<string, string>, extra: Partial<RoleConfig> = {}): RoleConfig => ({
  roles,
  rolePresets: [],
  activePreset: null,
  ...extra,
});

describe("parseModelRef — value grammar", () => {
  it("E1: role ref with canonical level", () => {
    expect(parseModelRef("@coding:high")).toEqual({ kind: "role", role: "coding", level: "high" });
  });
  it("role ref without level", () => {
    expect(parseModelRef("@fast")).toEqual({ kind: "role", role: "fast" });
  });
  it("E2: colon inside a model id is not a level", () => {
    expect(parseModelRef("openrouter/vendor:free")).toEqual({
      kind: "direct",
      model: "openrouter/vendor:free",
    });
  });
  it("direct ref splits a canonical level", () => {
    expect(parseModelRef("anthropic/claude-sonnet-4-5:high")).toEqual({
      kind: "direct",
      model: "anthropic/claude-sonnet-4-5",
      level: "high",
    });
  });
  it("E3: invalid role refs are rejected", () => {
    for (const v of ["@bad name", "@", "@fast:", "@a/b", "@:high"]) {
      expect(parseModelRef(v).kind).toBe("invalid");
    }
  });
  it("role with non-canonical suffix is invalid", () => {
    expect(parseModelRef("@fast:free").kind).toBe("invalid");
  });
  it("THINKING_LEVELS is the canonical list", () => {
    expect(THINKING_LEVELS).toEqual(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  });
});

describe("resolveModelRef", () => {
  const roles = { fast: "anthropic/claude-haiku-4-5:low", plain: "anthropic/claude-haiku-4-5" };
  it("E4: role level used when ref has none", () => {
    expect(resolveModelRef("@fast", cfg(roles))).toMatchObject({
      kind: "role",
      model: "anthropic/claude-haiku-4-5",
      provider: "anthropic",
      id: "claude-haiku-4-5",
      level: "low",
    });
  });
  it("E4: ref level overrides role level", () => {
    expect(resolveModelRef("@fast:medium", cfg(roles))).toMatchObject({
      model: "anthropic/claude-haiku-4-5",
      level: "medium",
    });
  });
  it("E4: no level at all", () => {
    const r = resolveModelRef("@plain", cfg(roles));
    expect(r.model).toBe("anthropic/claude-haiku-4-5");
    expect(r.level).toBeUndefined();
  });
  it("E5: unassigned role is unresolved with reason naming role", () => {
    const r = resolveModelRef("@research", cfg({}));
    expect(r.unresolved).toContain("research");
    expect(r.model).toBeUndefined();
  });
  it("E6: reads cfg.roles only — preset not re-applied", () => {
    const c = cfg(
      { fast: "a/A" },
      { activePreset: "cheap", rolePresets: [{ name: "cheap", roles: { fast: "b/B" } }] },
    );
    expect(resolveModelRef("@fast", c).model).toBe("a/A");
  });
  it("direct ref passes through", () => {
    expect(resolveModelRef("openrouter/vendor:free", cfg({}))).toMatchObject({
      kind: "direct",
      model: "openrouter/vendor:free",
      provider: "openrouter",
      id: "vendor:free",
    });
  });
  it("invalid ref is unresolved", () => {
    expect(resolveModelRef("@", cfg({})).unresolved).toBeTruthy();
  });
});

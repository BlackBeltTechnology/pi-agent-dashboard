/**
 * Tests for the shared role-schema core — the single definition every role
 * read surface derives from (bridge, plugin route, plugin client).
 *
 * Covers tasks 5.1–5.6 and the cross-surface agreement task 8.1.
 * See change: add-roles-read-api.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLE_NAMES,
  effectiveRoleNames,
  overlayRoles,
  parseRoleConfig,
  type RoleConfig,
  splitRef,
} from "../role-schema.js";

function cfg(partial: Partial<RoleConfig>): RoleConfig {
  return { roles: {}, rolePresets: [], activePreset: null, ...partial };
}

describe("effectiveRoleNames — axis construction (E18)", () => {
  it("is defaults ∪ roleNames ∪ assigned − removed, order-stable across calls", () => {
    const c = cfg({
      roles: { coding: "a/b", custom: "x/y" },
      roleNames: ["custom", "extra"],
      removedRoles: ["vision"],
    });
    const first = effectiveRoleNames(c);
    const second = effectiveRoleNames(c);
    expect(first).toEqual(second); // stable
    // defaults first (minus removed vision), then user-added, then assigned extras
    expect(first).toEqual([
      "planning",
      "coding",
      "compact",
      "fast",
      "research",
      "naming",
      "custom",
      "extra",
    ]);
    expect(first).not.toContain("vision");
  });
});

describe("built-in classification (E9)", () => {
  it("every canonical default is builtin; a user-added name is not", () => {
    const builtin = new Set<string>(DEFAULT_ROLE_NAMES);
    const c = cfg({ roles: { review: "x/y" }, roleNames: ["review"] });
    for (const name of effectiveRoleNames(c)) {
      const isDefault = (DEFAULT_ROLE_NAMES as readonly string[]).includes(name);
      expect(builtin.has(name)).toBe(isDefault);
    }
    expect(builtin.has("review")).toBe(false);
  });
});

describe("new built-in propagation (E10)", () => {
  it("a name in the default set appears unassigned without a consumer constant", () => {
    const c = cfg({ roles: {} });
    const names = effectiveRoleNames(c);
    for (const name of DEFAULT_ROLE_NAMES) expect(names).toContain(name);
    const overlay = overlayRoles(c);
    for (const name of DEFAULT_ROLE_NAMES) expect(overlay[name]).toBe("");
  });
});

describe("removal beats assignment (E6)", () => {
  it("a removed role is absent even when assigned, config unmodified", () => {
    const c = cfg({ roles: { vision: "x/y", coding: "a/b" }, removedRoles: ["vision"] });
    const snapshot = JSON.stringify(c);
    const names = effectiveRoleNames(c);
    expect(names).not.toContain("vision");
    const overlay = overlayRoles(c);
    expect(overlay).not.toHaveProperty("vision");
    expect(overlay.coding).toBe("a/b");
    expect(JSON.stringify(c)).toBe(snapshot); // pure — no mutation
  });
});

describe("parseRoleConfig totality (E15)", () => {
  it("discards malformed sub-values without throwing", () => {
    const parsed = parseRoleConfig({
      roles: { a: 42, b: "  ", c: " x/y " },
      rolePresets: [null, { name: "x", roles: null }, { name: "ok", roles: { coding: "a/b" } }],
      activePreset: 123,
    });
    // non-string / empty role values discarded; survivor trimmed
    expect(parsed.roles).toEqual({ c: "x/y" });
    // invalid preset entries discarded, well-formed retained
    expect(parsed.rolePresets).toEqual([{ name: "ok", roles: { coding: "a/b" } }]);
    // non-string activePreset coerced to null
    expect(parsed.activePreset).toBeNull();
  });

  it("returns a well-formed config for arbitrary garbage input", () => {
    for (const input of [null, undefined, 42, "str", [], { roles: [] }]) {
      const parsed = parseRoleConfig(input);
      expect(parsed.roles).toEqual({});
      expect(parsed.rolePresets).toEqual([]);
      expect(parsed.activePreset).toBeNull();
    }
  });
});

describe("duplicate preset names (E11)", () => {
  it("retains the FIRST entry's assignments", () => {
    const parsed = parseRoleConfig({
      rolePresets: [
        { name: "cheap", roles: { coding: "first/model" } },
        { name: "cheap", roles: { coding: "second/model" } },
      ],
    });
    expect(parsed.rolePresets).toHaveLength(1);
    expect(parsed.rolePresets[0]).toEqual({ name: "cheap", roles: { coding: "first/model" } });
  });
});

describe("splitRef", () => {
  it("splits provider/model:level", () => {
    expect(splitRef("anthropic/claude-opus-4-8:high")).toEqual({
      model: "anthropic/claude-opus-4-8",
      provider: "anthropic",
      thinkingLevel: "high",
    });
  });
  it("splits on the LAST colon", () => {
    expect(splitRef("a/b:high:low")).toEqual({ model: "a/b:high", provider: "a", thinkingLevel: "low" });
  });
  it("omits provider for a bare id", () => {
    expect(splitRef("deepseek-v4-flash")).toEqual({ model: "deepseek-v4-flash" });
  });
  it("omits undeterminable parts for degenerate refs, never throws", () => {
    expect(splitRef("a/b:")).toEqual({ model: "a/b", provider: "a" });
    expect(splitRef(":high")).toEqual({ thinkingLevel: "high" });
    expect(splitRef("anthropic/")).toEqual({ model: "anthropic/", provider: "anthropic" });
    expect(splitRef("a/b")).toEqual({ model: "a/b", provider: "a" });
  });
});

describe("cross-surface agreement — effective schema (F1)", () => {
  it("effective schema + assigned values agree, neither reports a removed name", () => {
    const c = cfg({
      roles: { coding: "a/b", review: "x/y" },
      roleNames: ["review"],
      removedRoles: ["vision"],
    });
    // The "roles:get-all" surface uses overlayRoles; the HTTP surface uses
    // effectiveRoleNames for its axis. They must agree on the effective names
    // and on every assigned value.
    const overlay = overlayRoles(c);
    const axis = effectiveRoleNames(c);
    expect(Object.keys(overlay)).toEqual(axis);
    for (const name of axis) {
      expect(overlay[name]).toBe(c.roles[name] ?? "");
    }
    expect(axis).not.toContain("vision");
    expect(overlay).not.toHaveProperty("vision");
  });
});

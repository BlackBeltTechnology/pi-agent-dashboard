/**
 * Tests for role-manager.ts — the dashboard-owned `roles:*` event handlers
 * that own `~/.pi/agent/providers.json#roles`, `#rolePresets`, `#activePreset`.
 *
 * Spec: openspec/changes/adopt-model-resolve-handler-and-roles-ownership/
 *       specs/dashboard-roles-ownership/spec.md
 *
 * HOME is overridden by the vitest globalSetup to a tmp dir, so each test
 * file gets its own ephemeral `~/.pi/agent/`. We reset per-test via the
 * pre-existing `~/.pi/agent/providers.json` path.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  activate,
  getModelRole,
  lookupRole,
  loadRoleConfig,
  saveRoleConfig,
  DEFAULT_ROLE_NAMES,
  overlayDefaultRoles,
  overlayRoles,
  effectiveRoleNames,
  addRoleName,
  removeRoleFromSchema,
  type RoleConfig,
} from "../role-manager.js";

/** Build the expected overlay map: every default name empty, then `assigned` wins. */
function withDefaults(assigned: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of DEFAULT_ROLE_NAMES) out[name] = "";
  return { ...out, ...assigned };
}

const CONFIG = () => join(homedir(), ".pi", "agent", "providers.json");

// Minimal ExtensionAPI stub: capture event handlers so tests can fire them.
function makeFakePi() {
  const handlers = new Map<string, (data: any) => void | Promise<void>>();
  const pi = {
    events: {
      on: (name: string, fn: (data: any) => void | Promise<void>) => {
        handlers.set(name, fn);
      },
      emit: async (name: string, data: any) => {
        const fn = handlers.get(name);
        if (fn) await fn(data);
      },
    },
  } as any;
  return { pi, handlers };
}

function resetConfig() {
  if (existsSync(CONFIG())) rmSync(CONFIG());
  mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
}

function readFile() {
  return JSON.parse(readFileSync(CONFIG(), "utf-8"));
}

beforeEach(() => {
  resetConfig();
});

afterEach(() => {
  resetConfig();
});

describe("loadRoleConfig", () => {
  it("returns empty when file is missing", () => {
    const cfg = loadRoleConfig();
    expect(cfg).toEqual({ roles: {}, rolePresets: [], activePreset: null });
  });

  it("returns empty when file is malformed JSON", () => {
    writeFileSync(CONFIG(), "{ not json");
    const cfg = loadRoleConfig();
    expect(cfg).toEqual({ roles: {}, rolePresets: [], activePreset: null });
  });

  it("reads roles, presets, and activePreset", () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { fast: "anthropic/haiku" },
      rolePresets: [{ name: "default", roles: { fast: "anthropic/haiku" } }],
      activePreset: "default",
    }));
    const cfg = loadRoleConfig();
    expect(cfg.roles).toEqual({ fast: "anthropic/haiku" });
    expect(cfg.rolePresets).toEqual([{ name: "default", roles: { fast: "anthropic/haiku" } }]);
    expect(cfg.activePreset).toBe("default");
  });
});

describe("saveRoleConfig", () => {
  it("preserves unrelated keys including providers and autonomousMode", () => {
    writeFileSync(CONFIG(), JSON.stringify({
      providers: { foo: { baseUrl: "http://x", apiKey: "k" } },
      autonomousMode: false,
      foo: "bar",
    }));
    saveRoleConfig({ roles: { fast: "x/y" }, rolePresets: [], activePreset: null });
    const after = readFile();
    expect(after.providers).toEqual({ foo: { baseUrl: "http://x", apiKey: "k" } });
    expect(after.autonomousMode).toBe(false);
    expect(after.foo).toBe("bar");
    expect(after.roles).toEqual({ fast: "x/y" });
  });

  it("writes atomically (no .tmp- file left behind)", () => {
    saveRoleConfig({ roles: { fast: "x/y" }, rolePresets: [], activePreset: null });
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const dir = join(homedir(), ".pi", "agent");
    const leftovers = readdirSync(dir).filter((n) => n.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });
});

describe("roles:get-all", () => {
  it("overlays default role names on a missing file and does not create it", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = {};
    await pi.events.emit("roles:get-all", data);
    expect(data.roles).toEqual(withDefaults());
    expect(data.presets).toEqual([]);
    expect(data.activePreset).toBeNull();
    // Overlay-only: reading must not write providers.json.
    expect(existsSync(CONFIG())).toBe(false);
  });

  it("overlays defaults onto assigned roles (assigned wins)", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { fast: "anthropic/opus" },
      rolePresets: [{ name: "default", roles: { fast: "anthropic/opus" } }],
      activePreset: "default",
    }));
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = {};
    await pi.events.emit("roles:get-all", data);
    expect(data.roles).toEqual(withDefaults({ fast: "anthropic/opus" }));
    expect(data.presets).toEqual([{ name: "default", roles: { fast: "anthropic/opus" } }]);
    expect(data.activePreset).toBe("default");
  });

  it("preserves non-default assigned roles in the overlay", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { custom: "x/y" }, rolePresets: [], activePreset: null,
    }));
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = {};
    await pi.events.emit("roles:get-all", data);
    expect(data.roles).toEqual(withDefaults({ custom: "x/y" }));
  });

  it("does not crash on malformed JSON (overlays defaults)", async () => {
    writeFileSync(CONFIG(), "{ not json");
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = {};
    await pi.events.emit("roles:get-all", data);
    expect(data.roles).toEqual(withDefaults());
  });
});

describe("overlayDefaultRoles", () => {
  it("maps every default name to empty when no assignments", () => {
    expect(overlayDefaultRoles({})).toEqual(withDefaults());
  });

  it("lets assigned values win and keeps extra roles", () => {
    expect(overlayDefaultRoles({ fast: "a/b", extra: "c/d" })).toEqual(
      withDefaults({ fast: "a/b", extra: "c/d" }),
    );
  });
});

describe("roles:set", () => {
  it("persists role assignment to disk", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = { role: "coding", modelId: "anthropic/claude-opus-4" };
    await pi.events.emit("roles:set", data);
    expect(data.success).toBe(true);
    expect(readFile().roles).toEqual({ coding: "anthropic/claude-opus-4" });
  });

  it("returns success=false when role or modelId is missing", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = {};
    await pi.events.emit("roles:set", data);
    expect(data.success).toBe(false);
    expect(existsSync(CONFIG())).toBe(false);
  });

  it("updates the active preset in-place", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { fast: "old" },
      rolePresets: [{ name: "default", roles: { fast: "old" } }],
      activePreset: "default",
    }));
    const { pi } = makeFakePi();
    activate(pi);
    await pi.events.emit("roles:set", { role: "fast", modelId: "new" });
    const after = readFile();
    expect(after.roles).toEqual({ fast: "new" });
    expect(after.rolePresets[0].roles).toEqual({ fast: "new" });
    expect(after.activePreset).toBe("default");
  });

  it("preserves autonomousMode key across writes", async () => {
    writeFileSync(CONFIG(), JSON.stringify({ autonomousMode: false }));
    const { pi } = makeFakePi();
    activate(pi);
    await pi.events.emit("roles:set", { role: "fast", modelId: "x/y" });
    expect(readFile().autonomousMode).toBe(false);
  });
});

describe("roles:preset-load", () => {
  it("replaces roles wholesale", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { fast: "old", slow: "leftover" },
      rolePresets: [{ name: "speed", roles: { fast: "x/y" } }],
      activePreset: null,
    }));
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = { name: "speed" };
    await pi.events.emit("roles:preset-load", data);
    expect(data.success).toBe(true);
    const after = readFile();
    expect(after.roles).toEqual({ fast: "x/y" });
    expect(after.activePreset).toBe("speed");
  });

  it("fails cleanly for unknown preset and does not write", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { fast: "old" },
      rolePresets: [],
      activePreset: null,
    }));
    const sizeBefore = readFileSync(CONFIG(), "utf-8");
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = { name: "nonexistent" };
    await pi.events.emit("roles:preset-load", data);
    expect(data.success).toBe(false);
    // File contents unchanged (no rewrite).
    expect(readFileSync(CONFIG(), "utf-8")).toBe(sizeBefore);
  });
});

describe("roles:preset-save", () => {
  it("creates a new preset entry", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    await pi.events.emit("roles:set", { role: "fast", modelId: "x/y" });
    const data: any = { name: "myset" };
    await pi.events.emit("roles:preset-save", data);
    expect(data.success).toBe(true);
    const after = readFile();
    expect(after.rolePresets).toEqual([{ name: "myset", roles: { fast: "x/y" } }]);
  });

  it("updates existing preset with same name", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { fast: "new" },
      rolePresets: [{ name: "myset", roles: { fast: "old" } }],
      activePreset: null,
    }));
    const { pi } = makeFakePi();
    activate(pi);
    await pi.events.emit("roles:preset-save", { name: "myset" });
    const after = readFile();
    expect(after.rolePresets).toEqual([{ name: "myset", roles: { fast: "new" } }]);
  });
});

describe("roles:preset-delete", () => {
  it("removes named preset", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: {},
      rolePresets: [{ name: "a", roles: {} }, { name: "b", roles: {} }],
      activePreset: null,
    }));
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = { name: "a" };
    await pi.events.emit("roles:preset-delete", data);
    expect(data.success).toBe(true);
    expect(readFile().rolePresets).toEqual([{ name: "b", roles: {} }]);
  });

  it("fails when preset does not exist", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = { name: "ghost" };
    await pi.events.emit("roles:preset-delete", data);
    expect(data.success).toBe(false);
  });

  it("clears activePreset when the active preset is deleted", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: {},
      rolePresets: [{ name: "a", roles: {} }],
      activePreset: "a",
    }));
    const { pi } = makeFakePi();
    activate(pi);
    await pi.events.emit("roles:preset-delete", { name: "a" });
    expect(readFile().activePreset).toBeNull();
  });
});

describe("roles:get-all builtinRoleNames", () => {
  it("includes builtinRoleNames equal to DEFAULT_ROLE_NAMES", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = {};
    await pi.events.emit("roles:get-all", data);
    expect(data.builtinRoleNames).toEqual([...DEFAULT_ROLE_NAMES]);
  });
});

describe("roles:remove", () => {
  it("purges a custom role from disk and reports success", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { review: "anthropic/haiku" },
      roleNames: ["review"],
      rolePresets: [{ name: "cheap", roles: { review: "anthropic/haiku" } }],
      activePreset: null,
    }));
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = { role: "review" };
    await pi.events.emit("roles:remove", data);
    expect(data.success).toBe(true);
    const after = readFile();
    expect(after.roles.review).toBeUndefined();
    expect(after.rolePresets[0].roles.review).toBeUndefined();
    expect(after.roleNames ?? []).not.toContain("review");
  });

  it("rejects a built-in role name without writing", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { coding: "anthropic/opus" }, rolePresets: [], activePreset: null,
    }));
    const before = readFileSync(CONFIG(), "utf-8");
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = { role: "coding" };
    await pi.events.emit("roles:remove", data);
    expect(data.success).toBe(false);
    // No rewrite: built-in guard rejects before save.
    expect(readFileSync(CONFIG(), "utf-8")).toBe(before);
  });

  it("rejects a missing / syntactically invalid role name", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    const empty: any = {};
    await pi.events.emit("roles:remove", empty);
    expect(empty.success).toBe(false);
    const bad: any = { role: "a/b" };
    await pi.events.emit("roles:remove", bad);
    expect(bad.success).toBe(false);
    expect(existsSync(CONFIG())).toBe(false);
  });

  it("reports success (no-op atomic rewrite) for a valid custom name absent from config", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { coding: "anthropic/opus" }, rolePresets: [], activePreset: null,
    }));
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = { role: "ghost-role" };
    await pi.events.emit("roles:remove", data);
    // removeRoleFromSchema is idempotent: the name isn't present, so the write
    // is a no-op rewrite and the handler still reports success.
    expect(data.success).toBe(true);
    expect(readFile().roles).toEqual({ coding: "anthropic/opus" });
  });
});

describe("roles:set validation (bridge trust boundary)", () => {
  it("rejects a syntactically invalid custom role name without writing", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = { role: "bad/name", modelId: "anthropic/haiku" };
    await pi.events.emit("roles:set", data);
    expect(data.success).toBe(false);
    expect(existsSync(CONFIG())).toBe(false);
  });

  it("still accepts a valid custom role name", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = { role: "doubt-verifier-1", modelId: "anthropic/haiku" };
    await pi.events.emit("roles:set", data);
    expect(data.success).toBe(true);
    expect(readFile().roles["doubt-verifier-1"]).toBe("anthropic/haiku");
  });
});

describe("role:resolve-model (subagents adapter)", () => {
  it("sets probe.resolved to the assigned model for a @role ref", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { fast: "my-google/gemma-4-31b-it" },
      rolePresets: [],
      activePreset: null,
    }));
    const { pi } = makeFakePi();
    activate(pi);
    const probe: any = { ref: "@fast" };
    await pi.events.emit("role:resolve-model", probe);
    expect(probe.resolved).toBe("my-google/gemma-4-31b-it");
    expect(probe.available).toEqual({ fast: "my-google/gemma-4-31b-it" });
  });

  it("accepts a bare role name without the @ prefix", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { fast: "anthropic/haiku" }, rolePresets: [], activePreset: null,
    }));
    const { pi } = makeFakePi();
    activate(pi);
    const probe: any = { ref: "fast" };
    await pi.events.emit("role:resolve-model", probe);
    expect(probe.resolved).toBe("anthropic/haiku");
  });

  it("leaves probe.resolved unset and sets a structured reason when unconfigured", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    const probe: any = { ref: "@ghost" };
    await pi.events.emit("role:resolve-model", probe);
    expect(probe.resolved).toBeUndefined();
    expect(probe.available).toEqual({});
    expect(probe.reason).toBe("role 'ghost' not configured yet");
  });

  it("does not set a reason when the role resolves", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { fast: "anthropic/haiku" }, rolePresets: [], activePreset: null,
    }));
    const { pi } = makeFakePi();
    activate(pi);
    const probe: any = { ref: "@fast" };
    await pi.events.emit("role:resolve-model", probe);
    expect(probe.resolved).toBe("anthropic/haiku");
    expect(probe.reason).toBeUndefined();
  });

  it("re-reads disk so cross-session role edits are visible", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    await pi.events.emit("roles:set", { role: "fast", modelId: "x/y" });
    const probe: any = { ref: "@fast" };
    await pi.events.emit("role:resolve-model", probe);
    expect(probe.resolved).toBe("x/y");
  });

  it("ignores a malformed probe without throwing", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    await expect(pi.events.emit("role:resolve-model", {})).resolves.toBeUndefined();
    await expect(pi.events.emit("role:resolve-model", null)).resolves.toBeUndefined();
  });
});

describe("editable role-name schema", () => {
  const base = (over: Partial<RoleConfig> = {}): RoleConfig => ({
    roles: {},
    rolePresets: [],
    activePreset: null,
    ...over,
  });

  it("effectiveRoleNames = defaults \u222a added \u2212 removed, order-stable", () => {
    const names = effectiveRoleNames(base({ roleNames: ["review"], removedRoles: ["vision"] }));
    expect(names).toContain("review");
    expect(names).not.toContain("vision");
    // defaults first, then adds
    expect(names[0]).toBe("planning");
    expect(names.indexOf("review")).toBeGreaterThan(names.indexOf("research"));
  });

  it("overlayRoles surfaces an added role as an empty slot", () => {
    const out = overlayRoles(base({ roleNames: ["review"] }));
    expect(out.review).toBe("");
    expect(out.planning).toBe("");
  });

  it("overlayRoles omits a removed default (not re-injected)", () => {
    const out = overlayRoles(base({ removedRoles: ["vision"] }));
    expect(out.vision).toBeUndefined();
    expect(out.coding).toBe("");
  });

  it("addRoleName records a non-default and clears its removal marker", () => {
    const cfg = base({ removedRoles: ["review"] });
    addRoleName(cfg, "review");
    expect(cfg.roleNames).toEqual(["review"]);
    expect(cfg.removedRoles).toEqual([]);
  });

  it("removeRoleFromSchema purges from roles, every preset, and marks defaults removed", () => {
    const cfg = base({
      roles: { vision: "x/y" },
      rolePresets: [
        { name: "cheap", roles: { vision: "a/b" } },
        { name: "premium", roles: { vision: "c/d" } },
      ],
    });
    removeRoleFromSchema(cfg, "vision");
    expect(cfg.roles.vision).toBeUndefined();
    expect(cfg.rolePresets[0].roles.vision).toBeUndefined();
    expect(cfg.rolePresets[1].roles.vision).toBeUndefined();
    expect(cfg.removedRoles).toContain("vision");
  });

  it("saveRoleConfig round-trips roleNames + removedRoles and preserves unrelated keys", () => {
    writeFileSync(CONFIG(), JSON.stringify({ providers: { p: { baseUrl: "u", apiKey: "k" } } }));
    saveRoleConfig(base({ roleNames: ["review"], removedRoles: ["vision"] }));
    const after = loadRoleConfig();
    expect(after.roleNames).toEqual(["review"]);
    expect(after.removedRoles).toEqual(["vision"]);
    expect(readFile().providers).toEqual({ p: { baseUrl: "u", apiKey: "k" } });
  });
});

describe("lookupRole", () => {
  it("returns the literal for a bound bare role name", () => {
    writeFileSync(CONFIG(), JSON.stringify({ roles: { fast: "anthropic/haiku" } }));
    expect(lookupRole("fast")).toEqual({ literal: "anthropic/haiku" });
  });

  it("strips a leading @ and returns the literal", () => {
    writeFileSync(CONFIG(), JSON.stringify({ roles: { fast: "anthropic/haiku" } }));
    expect(lookupRole("@fast")).toEqual({ literal: "anthropic/haiku" });
  });

  it("returns a structured reason for an unset role", () => {
    expect(lookupRole("@ghost")).toEqual({ reason: "role 'ghost' not configured yet" });
  });

  it("returns a reason for an empty role name", () => {
    expect(lookupRole("@")).toEqual({ reason: "empty role name" });
  });

  it("re-reads disk so cross-session edits are visible", () => {
    writeFileSync(CONFIG(), JSON.stringify({ roles: { fast: "a/b" } }));
    expect(lookupRole("fast")).toEqual({ literal: "a/b" });
    writeFileSync(CONFIG(), JSON.stringify({ roles: { fast: "c/d" } }));
    expect(lookupRole("fast")).toEqual({ literal: "c/d" });
  });
});

describe("getModelRole", () => {
  it("returns the current model assigned to a role, re-reading from disk", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    await pi.events.emit("roles:set", { role: "fast", modelId: "anthropic/haiku" });
    expect(getModelRole("fast")).toBe("anthropic/haiku");

    // Simulate cross-session update: another writer mutates the file directly.
    const raw = readFile();
    raw.roles.fast = "anthropic/sonnet";
    writeFileSync(CONFIG(), JSON.stringify(raw));
    expect(getModelRole("fast")).toBe("anthropic/sonnet");
  });

  it("returns undefined for unknown role", () => {
    expect(getModelRole("nope")).toBeUndefined();
  });
});

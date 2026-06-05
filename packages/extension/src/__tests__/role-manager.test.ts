/**
 * Tests for role-manager.ts — the relocated `flow:role-*` event handlers
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

import { activate, getModelRole, loadRoleConfig, saveRoleConfig } from "../role-manager.js";

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

describe("flow:role-get-all", () => {
  it("returns empty snapshot on missing file", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = {};
    await pi.events.emit("flow:role-get-all", data);
    expect(data.roles).toEqual({});
    expect(data.presets).toEqual([]);
    expect(data.activePreset).toBeNull();
  });

  it("returns current roles, presets, and active preset", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { fast: "anthropic/opus" },
      rolePresets: [{ name: "default", roles: { fast: "anthropic/opus" } }],
      activePreset: "default",
    }));
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = {};
    await pi.events.emit("flow:role-get-all", data);
    expect(data.roles).toEqual({ fast: "anthropic/opus" });
    expect(data.presets).toEqual([{ name: "default", roles: { fast: "anthropic/opus" } }]);
    expect(data.activePreset).toBe("default");
  });

  it("does not crash on malformed JSON", async () => {
    writeFileSync(CONFIG(), "{ not json");
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = {};
    await pi.events.emit("flow:role-get-all", data);
    expect(data.roles).toEqual({});
  });
});

describe("flow:role-set", () => {
  it("persists role assignment to disk", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = { role: "coding", modelId: "anthropic/claude-opus-4" };
    await pi.events.emit("flow:role-set", data);
    expect(data.success).toBe(true);
    expect(readFile().roles).toEqual({ coding: "anthropic/claude-opus-4" });
  });

  it("returns success=false when role or modelId is missing", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = {};
    await pi.events.emit("flow:role-set", data);
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
    await pi.events.emit("flow:role-set", { role: "fast", modelId: "new" });
    const after = readFile();
    expect(after.roles).toEqual({ fast: "new" });
    expect(after.rolePresets[0].roles).toEqual({ fast: "new" });
    expect(after.activePreset).toBe("default");
  });

  it("preserves autonomousMode key across writes", async () => {
    writeFileSync(CONFIG(), JSON.stringify({ autonomousMode: false }));
    const { pi } = makeFakePi();
    activate(pi);
    await pi.events.emit("flow:role-set", { role: "fast", modelId: "x/y" });
    expect(readFile().autonomousMode).toBe(false);
  });
});

describe("flow:role-preset-load", () => {
  it("replaces roles wholesale", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { fast: "old", slow: "leftover" },
      rolePresets: [{ name: "speed", roles: { fast: "x/y" } }],
      activePreset: null,
    }));
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = { name: "speed" };
    await pi.events.emit("flow:role-preset-load", data);
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
    await pi.events.emit("flow:role-preset-load", data);
    expect(data.success).toBe(false);
    // File contents unchanged (no rewrite).
    expect(readFileSync(CONFIG(), "utf-8")).toBe(sizeBefore);
  });
});

describe("flow:role-preset-save", () => {
  it("creates a new preset entry", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    await pi.events.emit("flow:role-set", { role: "fast", modelId: "x/y" });
    const data: any = { name: "myset" };
    await pi.events.emit("flow:role-preset-save", data);
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
    await pi.events.emit("flow:role-preset-save", { name: "myset" });
    const after = readFile();
    expect(after.rolePresets).toEqual([{ name: "myset", roles: { fast: "new" } }]);
  });
});

describe("flow:role-preset-delete", () => {
  it("removes named preset", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: {},
      rolePresets: [{ name: "a", roles: {} }, { name: "b", roles: {} }],
      activePreset: null,
    }));
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = { name: "a" };
    await pi.events.emit("flow:role-preset-delete", data);
    expect(data.success).toBe(true);
    expect(readFile().rolePresets).toEqual([{ name: "b", roles: {} }]);
  });

  it("fails when preset does not exist", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    const data: any = { name: "ghost" };
    await pi.events.emit("flow:role-preset-delete", data);
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
    await pi.events.emit("flow:role-preset-delete", { name: "a" });
    expect(readFile().activePreset).toBeNull();
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

  it("leaves probe.resolved unset when role is unassigned", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    const probe: any = { ref: "@ghost" };
    await pi.events.emit("role:resolve-model", probe);
    expect(probe.resolved).toBeUndefined();
    expect(probe.available).toEqual({});
  });

  it("re-reads disk so cross-session role edits are visible", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    await pi.events.emit("flow:role-set", { role: "fast", modelId: "x/y" });
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

describe("getModelRole", () => {
  it("returns the current model assigned to a role, re-reading from disk", async () => {
    const { pi } = makeFakePi();
    activate(pi);
    await pi.events.emit("flow:role-set", { role: "fast", modelId: "anthropic/haiku" });
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

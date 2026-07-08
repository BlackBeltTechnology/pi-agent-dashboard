/**
 * Tests for the agent-facing role/model tools (list_models, list_roles,
 * update_roles) registered by role-model-tools.ts.
 *
 * See change: add-agent-role-model-tools.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activate as activateProviderRegister } from "../provider-register.js";
import { buildModelRows, registerRoleModelTools } from "../role-model-tools.js";

const CONFIG = () => join(homedir(), ".pi", "agent", "providers.json");

function resetConfig() {
  mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
  if (existsSync(CONFIG())) rmSync(CONFIG());
}
function readFile() {
  return JSON.parse(readFileSync(CONFIG(), "utf-8"));
}

// Minimal pi stub capturing registered tools.
function mkPi() {
  const tools = new Map<string, any>();
  const pi: any = {
    registerTool: (t: any) => tools.set(t.name, t),
    events: { on: () => {}, emit: async () => {} },
  };
  return { pi, tools };
}

// Fake pi ModelRegistry.
function makeRegistry(available: any[], all?: any[]) {
  return {
    getAvailable: () => available,
    getAll: () => all ?? available,
  };
}

beforeEach(resetConfig);
afterEach(resetConfig);

describe("list_models", () => {
  it("returns assignable refs with capability metadata", async () => {
    const { pi, tools } = mkPi();
    const registry = makeRegistry([
      { provider: "anthropic", id: "claude-x", reasoning: true, input: ["text", "image"], contextWindow: 200000, cost: { input: 3, output: 15 } },
    ]);
    registerRoleModelTools(pi, { getRegistry: () => registry });
    const res = await tools.get("list_models").execute("id", {}, null, null, {});
    const { models } = res.details;
    expect(models).toHaveLength(1);
    expect(models[0].ref).toBe("anthropic/claude-x");
    expect(models[0].provider).toBe("anthropic");
    expect(models[0].id).toBe("claude-x");
    expect(models[0].reasoning).toBe(true);
    expect(models[0].input).toEqual(["text", "image"]);
    expect(models[0].contextWindow).toBe(200000);
    expect(models[0].cost).toEqual({ input: 3, output: 15 });
  });

  it("works when roles are missing/malformed (roles-independent)", async () => {
    writeFileSync(CONFIG(), "{ not json");
    const { pi, tools } = mkPi();
    const registry = makeRegistry([{ provider: "openai", id: "gpt-5" }]);
    registerRoleModelTools(pi, { getRegistry: () => registry });
    const res = await tools.get("list_models").execute("id", {}, null, null, {});
    expect(res.details.models[0].ref).toBe("openai/gpt-5");
  });

  it("flags custom-registered providers with custom:true (matching ModelSelector source)", async () => {
    // Register a custom provider so getCustomProviderNames() knows it. The
    // provider-register activate() reads providers.json#providers.
    writeFileSync(CONFIG(), JSON.stringify({
      providers: { mycustom: { baseUrl: "http://x", apiKey: "$MYKEY" } },
    }));
    process.env.MYKEY = "";
    const fakePi: any = {
      events: { on: () => {} },
      on: () => {},
      registerProvider: () => {},
      unregisterProvider: () => {},
    };
    activateProviderRegister(fakePi);

    const { pi, tools } = mkPi();
    const registry = makeRegistry([{ provider: "mycustom", id: "foo-v2" }]);
    registerRoleModelTools(pi, { getRegistry: () => registry });
    const res = await tools.get("list_models").execute("id", {}, null, null, {});
    const row = res.details.models.find((m: any) => m.ref === "mycustom/foo-v2");
    expect(row).toBeDefined();
    expect(row.custom).toBe(true);
  });

  it("annotated mode surfaces uncredentialed models with excludedReason", async () => {
    const { pi, tools } = mkPi();
    const reachable = { provider: "anthropic", id: "claude-x" };
    const excluded = { provider: "mycustom", id: "foo-v2" };
    const registry = makeRegistry([reachable], [reachable, excluded]);
    registerRoleModelTools(pi, { getRegistry: () => registry });

    const def = await tools.get("list_models").execute("id", {}, null, null, {});
    expect(def.details.models.some((m: any) => m.ref === "mycustom/foo-v2")).toBe(false);

    const ann = await tools.get("list_models").execute("id", { annotated: true }, null, null, {});
    const row = ann.details.models.find((m: any) => m.ref === "mycustom/foo-v2");
    expect(row.excludedReason).toBe("no-credential");
    const inc = ann.details.models.find((m: any) => m.ref === "anthropic/claude-x");
    expect(inc.excludedReason).toBeNull();
  });

  it("buildModelRows returns [] when no registry is available", () => {
    expect(buildModelRows(null, false)).toEqual([]);
  });
});

describe("list_roles", () => {
  it("returns bound roles only, presets, and activePreset — no models key", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { planning: "anthropic/claude-x", coding: "openai/gpt-5", vision: "" },
      rolePresets: [{ name: "cheap", roles: {} }, { name: "premium", roles: {} }],
      activePreset: "cheap",
    }));
    const { pi, tools } = mkPi();
    registerRoleModelTools(pi, { getRegistry: () => null });
    const res = await tools.get("list_roles").execute("id", {}, null, null, {});
    expect(res.details.roles).toEqual({ planning: "anthropic/claude-x", coding: "openai/gpt-5" });
    expect(res.details.roles.vision).toBeUndefined();
    expect(res.details.presets).toEqual(["cheap", "premium"]);
    expect(res.details.activePreset).toBe("cheap");
    expect("models" in res.details).toBe(false);
  });

  it("tolerates a malformed role slice", async () => {
    writeFileSync(CONFIG(), "{ not json");
    const { pi, tools } = mkPi();
    registerRoleModelTools(pi, { getRegistry: () => null });
    const res = await tools.get("list_roles").execute("id", {}, null, null, {});
    expect(res.details).toEqual({ roles: {}, presets: [], activePreset: null });
  });
});

describe("update_roles", () => {
  const confirmCtx = (confirmed: boolean) => ({ ui: { confirm: async () => confirmed } });

  it("declining confirmation returns success:false and does NOT write", async () => {
    const { pi, tools } = mkPi();
    registerRoleModelTools(pi, { getRegistry: () => null });
    const res = await tools.get("update_roles").execute(
      "id", { action: "set_role", role: "review", ref: "anthropic/claude-x" }, null, null, confirmCtx(false),
    );
    expect(res.details.success).toBe(false);
    expect(existsSync(CONFIG())).toBe(false);
  });

  it("set_role creates a new role on first assignment (confirmed)", async () => {
    const { pi, tools } = mkPi();
    registerRoleModelTools(pi, { getRegistry: () => null });
    const res = await tools.get("update_roles").execute(
      "id", { action: "set_role", role: "review", ref: "anthropic/claude-x" }, null, null, confirmCtx(true),
    );
    expect(res.details.success).toBe(true);
    expect(readFile().roles.review).toBe("anthropic/claude-x");
    expect(readFile().roleNames).toContain("review");
  });

  it("set_role targets a named preset without loading it", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { coding: "old/model" },
      rolePresets: [{ name: "premium", roles: {} }],
      activePreset: null,
    }));
    const { pi, tools } = mkPi();
    registerRoleModelTools(pi, { getRegistry: () => null });
    await tools.get("update_roles").execute(
      "id", { action: "set_role", role: "coding", ref: "openai/gpt-5", preset: "premium" }, null, null, confirmCtx(true),
    );
    const after = readFile();
    expect(after.rolePresets[0].roles.coding).toBe("openai/gpt-5");
    expect(after.roles.coding).toBe("old/model"); // active map unchanged
  });

  it("remove_role purges from active map and every preset, preserving unrelated keys", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      providers: { p: { baseUrl: "u", apiKey: "k" } },
      autonomousMode: false,
      roles: { vision: "x/y" },
      rolePresets: [
        { name: "cheap", roles: { vision: "a/b" } },
        { name: "premium", roles: { vision: "c/d" } },
      ],
      activePreset: null,
    }));
    const { pi, tools } = mkPi();
    registerRoleModelTools(pi, { getRegistry: () => null });
    await tools.get("update_roles").execute(
      "id", { action: "remove_role", role: "vision" }, null, null, confirmCtx(true),
    );
    const after = readFile();
    expect(after.roles.vision).toBeUndefined();
    expect(after.rolePresets[0].roles.vision).toBeUndefined();
    expect(after.rolePresets[1].roles.vision).toBeUndefined();
    expect(after.providers).toEqual({ p: { baseUrl: "u", apiKey: "k" } });
    expect(after.autonomousMode).toBe(false);
  });

  it("create_preset / load_preset / delete_preset round-trip (confirmed)", async () => {
    writeFileSync(CONFIG(), JSON.stringify({ roles: { fast: "a/b" }, rolePresets: [], activePreset: null }));
    const { pi, tools } = mkPi();
    registerRoleModelTools(pi, { getRegistry: () => null });
    const tool = tools.get("update_roles");

    await tool.execute("id", { action: "create_preset", name: "snap" }, null, null, confirmCtx(true));
    expect(readFile().rolePresets).toEqual([{ name: "snap", roles: { fast: "a/b" } }]);

    await tool.execute("id", { action: "set_role", role: "fast", ref: "c/d" }, null, null, confirmCtx(true));
    await tool.execute("id", { action: "load_preset", name: "snap" }, null, null, confirmCtx(true));
    expect(readFile().roles.fast).toBe("a/b");
    expect(readFile().activePreset).toBe("snap");

    const del = await tool.execute("id", { action: "delete_preset", name: "snap" }, null, null, confirmCtx(true));
    expect(del.details.success).toBe(true);
    expect(readFile().rolePresets).toEqual([]);
    expect(readFile().activePreset).toBeNull();
  });
});

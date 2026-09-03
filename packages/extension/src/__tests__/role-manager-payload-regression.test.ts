/**
 * Payload-regression for the shared-helper extraction (change: add-roles-read-api).
 *
 * `roles:get-all` must stay byte-identical after moving DEFAULT_ROLE_NAMES /
 * effectiveRoleNames / overlayRoles into the shared package — for every
 * well-formed config with no removal/assignment collision. The change permits
 * exactly two corrections, each asserted here:
 *   (F2a) a structurally invalid preset entry is now dropped (was relayed);
 *   (F2b) a role with both a removal marker and an assignment is now omitted.
 *
 * HOME is overridden per-file (see extension vitest config) so this writes an
 * ephemeral ~/.pi/agent/providers.json.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activate, DEFAULT_ROLE_NAMES } from "../role-manager.js";

const CONFIG = () => join(homedir(), ".pi", "agent", "providers.json");

function makeFakePi() {
  const handlers = new Map<string, (data: any) => void | Promise<void>>();
  const pi = {
    events: {
      on: (name: string, fn: (data: any) => void | Promise<void>) => handlers.set(name, fn),
      emit: async (name: string, data: any) => {
        const fn = handlers.get(name);
        if (fn) await fn(data);
      },
    },
  } as any;
  return { pi };
}

function resetConfig() {
  if (existsSync(CONFIG())) rmSync(CONFIG());
  mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
}

async function getAll(config: unknown): Promise<any> {
  writeFileSync(CONFIG(), JSON.stringify(config));
  const { pi } = makeFakePi();
  activate(pi);
  const data: any = {};
  await pi.events.emit("roles:get-all", data);
  return data;
}

function withDefaults(assigned: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of DEFAULT_ROLE_NAMES) out[name] = "";
  return { ...out, ...assigned };
}

beforeEach(resetConfig);
afterEach(resetConfig);

describe("roles:get-all — unchanged for well-formed configs (F2)", () => {
  it("preserves the overlay, presets, activePreset, builtinRoleNames", async () => {
    const config = {
      roles: { fast: "anthropic/haiku", custom: "x/y" },
      rolePresets: [{ name: "default", roles: { fast: "anthropic/haiku" } }],
      activePreset: "default",
    };
    const data = await getAll(config);
    expect(data.roles).toEqual(withDefaults({ fast: "anthropic/haiku", custom: "x/y" }));
    expect(data.presets).toEqual([{ name: "default", roles: { fast: "anthropic/haiku" } }]);
    expect(data.activePreset).toBe("default");
    expect(data.builtinRoleNames).toEqual([...DEFAULT_ROLE_NAMES]);
  });
});

describe("declared correction F2a — invalid preset entries dropped", () => {
  it("discards a non-object entry and a preset whose roles is not an object", async () => {
    const data = await getAll({
      roles: { fast: "a/b" },
      rolePresets: [null, { name: "bad", roles: null }, { name: "ok", roles: { fast: "a/b" } }],
    });
    expect(data.presets).toEqual([{ name: "ok", roles: { fast: "a/b" } }]);
  });
});

describe("declared correction F2b — removal beats assignment", () => {
  it("omits a role carrying both a removal marker and an assignment", async () => {
    const data = await getAll({
      roles: { vision: "x/y", fast: "a/b" },
      removedRoles: ["vision"],
    });
    expect(data.roles).not.toHaveProperty("vision");
    expect(data.roles.fast).toBe("a/b");
  });
});

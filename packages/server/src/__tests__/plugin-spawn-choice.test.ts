/**
 * Plugin spawnSession hook — `@role` + `thinkingLevel` mapping, literal
 * pass-through, pi-only rejection with `agent`.
 * test-plan: E15, E16, E17, E18, E19. See change: add-spawn-model-choice.
 * Exemplar: acp-plugin-spawn.test.ts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validatePluginAcpSpawn } from "../spawn-process/acp-spawn.js";
import { mapPluginSpawnOptions } from "../spawn-process/plugin-spawn-choice.js";

let home: string;
let orig: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "plug-choice-"));
  orig = process.env.HOME as string;
  process.env.HOME = home;
  fs.mkdirSync(path.join(home, ".pi", "dashboard"), { recursive: true });
  fs.writeFileSync(path.join(home, ".pi", "dashboard", "config.json"), JSON.stringify({ acpAgents: [{ id: "qmt", name: "q", command: "q" }] }));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  process.env.HOME = orig;
  fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const roles = (r: Record<string, string>) => () => ({ roles: r });

describe("plugin spawn choice", () => {
  it("E15: @role + thinkingLevel → concrete model + field level", () => {
    const { options, warning } = mapPluginSpawnOptions(
      { cwd: "/p", model: "@review", thinkingLevel: "low" },
      { readRoles: roles({ review: "zai/glm-5.3" }) },
    );
    expect(options).toMatchObject({ model: "zai/glm-5.3", thinking: "low" });
    expect(warning).toBeUndefined();
  });

  it("E16: literal model passes through verbatim, no warning", () => {
    const readRoles = vi.fn(roles({}));
    const { options, warning } = mapPluginSpawnOptions({ cwd: "/p", model: "sonnet" }, { readRoles });
    expect(options.model).toBe("sonnet");
    expect(warning).toBeUndefined();
    expect(readRoles).not.toHaveBeenCalled();
  });

  it("E17: unresolvable role → no model, warning names it", () => {
    const { options, warning } = mapPluginSpawnOptions({ cwd: "/p", model: "@ghost" }, { readRoles: roles({}) });
    expect(options).not.toHaveProperty("model");
    expect(warning).toContain("ghost");
  });

  it("E18: agent + thinkingLevel rejected as pi-only", () => {
    expect(validatePluginAcpSpawn({ agent: "qmt", thinkingLevel: "low" })).toMatch(/thinkingLevel/);
  });

  it("E19: no model → no model / thinking in options", () => {
    const { options } = mapPluginSpawnOptions({ cwd: "/p" });
    expect(options).not.toHaveProperty("model");
    expect(options).not.toHaveProperty("thinking");
  });

  it("thinking-only pairs with the default model; invalid level warns", () => {
    expect(mapPluginSpawnOptions({ cwd: "/p", thinkingLevel: "high" }, { defaultModel: "a/b" }).options).toMatchObject({
      model: "a/b",
      thinking: "high",
    });
    const bad = mapPluginSpawnOptions({ cwd: "/p", thinkingLevel: "turbo" });
    expect(bad.options).not.toHaveProperty("thinking");
    expect(bad.warning).toBeTruthy();
  });
});

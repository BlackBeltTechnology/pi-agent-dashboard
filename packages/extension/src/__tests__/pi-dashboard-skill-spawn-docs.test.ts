/**
 * The pi-dashboard skill (and its claude-plugin mirror) documents the spawn
 * model choice. test-plan: E46. See change: add-spawn-model-choice.
 * Exemplar: packages/apple-tools/src/__tests__/skill.test.ts (content test).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SKILL = path.join(PKG, ".pi/skills/pi-dashboard");
const MIRROR = path.resolve(PKG, "../claude-plugin/skills/pi-dashboard-control");
const read = (p: string) => fs.readFileSync(p, "utf8");

describe("pi-dashboard skill spawn docs (E46)", () => {
  it("the spawn command documents --model and --thinking", () => {
    const cmd = read(path.join(SKILL, "commands/dashboard-session-spawn.md"));
    expect(cmd).toContain("--model");
    expect(cmd).toContain("--thinking");
    expect(cmd).toContain("@role");
  });

  it("the API reference (and its mirror) lists the body fields and the 400 cases", () => {
    for (const file of [path.join(SKILL, "references/api-reference.md"), path.join(MIRROR, "references/api-reference.md")]) {
      const spawn = read(file).split("### `POST /api/session/spawn`")[1]?.split("\n### ")[0] ?? "";
      for (const field of ["model", "thinkingLevel", "initialPrompt", "attachProposal", "400", "@role"]) {
        expect(spawn, `${file}: ${field}`).toContain(field);
      }
    }
  });

  it("recipes use the string return of bus.spawn", () => {
    const recipes = read(path.join(SKILL, "references/recipes.md"));
    expect(recipes).not.toMatch(/\{\s*sessionId\s*\}\s*=\s*await bus\.spawn/);
    expect(recipes).toMatch(/const sessionId = await bus\.spawn\(/);
  });

  it("the claude-plugin control skill shows the optional fields", () => {
    const skill = read(path.join(MIRROR, "SKILL.md"));
    expect(skill).toContain('"model":"@planning"');
    expect(skill).toContain("thinkingLevel");
  });
});

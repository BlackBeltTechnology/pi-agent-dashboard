/**
 * Executes every skill recipe once against real binaries (opt-in; needs ffmpeg for inputs the recipes generate):
 *
 *   CRAFT_E2E=1 CRAFT_HOME=/tmp/craft-home vitest run skills-recipes
 *   CRAFT_E2E=1 CRAFT_WORKFLOW_E2E=1 vitest run skills-recipes          # also the 4 workflow skills (need jq)
 *   CRAFT_E2E=1 CRAFT_RECIPE_APPS=filmcraft,soundcraft vitest run skills-recipes   # subset
 *
 * A recipe is a code fence tagged `recipe: <id>`; it runs under `bash -e` in a fresh tmp dir with `pi-craft` on
 * PATH, so a recipe passes only if every command exits 0 including its closing `pi-craft verify`.
 * See change: add-craft-apps-core (task 6.4–6.6, spec craft-app-skills "Recipes are verified").
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTmp, tmpDir } from "./helpers/fixtures.js";
import { fences, loadSkill, PKG_DIR, SKILL_NAMES, WORKFLOW_SKILL_NAMES } from "./helpers/skills.js";

const enabled = !!process.env.CRAFT_E2E;
/** Workflow recipes also need ffmpeg + jq and several provisioned apps: a separate opt-in on top of CRAFT_E2E. */
const workflowEnabled = enabled && !!process.env.CRAFT_WORKFLOW_E2E;
const only = process.env.CRAFT_RECIPE_APPS?.split(",").filter(Boolean);
afterAll(cleanupTmp);

const binDir = tmpDir("craft-recipe-bin-");
fs.symlinkSync(path.join(PKG_DIR, "bin", "pi-craft"), path.join(binDir, "pi-craft"));
fs.symlinkSync(path.join(PKG_DIR, "bin", "pi-photocraft"), path.join(binDir, "pi-photocraft"));

for (const name of SKILL_NAMES) {
  if (only && !only.includes(name)) continue;
  const recipes = fences(loadSkill(name).body).filter((f) => f.recipe);
  describe.skipIf(!enabled)(`${name} recipes (real binaries)`, () => {
    for (const r of recipes) {
      it(`recipe ${r.recipe} runs and verifies`, () => {
        const cwd = tmpDir("craft-recipe-");
        const res = spawnSync("bash", ["-e", "-o", "pipefail", "-c", r.code], {
          cwd,
          encoding: "utf8",
          env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, NODE_OPTIONS: "" },
          timeout: 240_000,
          maxBuffer: 64 * 1024 * 1024,
        });
        expect(res.status, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`).toBe(0);
      }, 260_000);
    }
  });
}

/** Run one recipe fence under `bash -e` in a fresh tmp dir; returns the result and the dir. */
function runRecipe(code: string, env: Record<string, string> = {}) {
  const cwd = tmpDir("craft-recipe-");
  const res = spawnSync("bash", ["-e", "-o", "pipefail", "-c", code], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env, PATH: `${binDir}:${process.env.PATH}`, NODE_OPTIONS: "" },
    timeout: 240_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { res, cwd };
}

// Workflow skills: their recipes chain several apps; opt-in separately from the app recipes (X1) because they need
// ffmpeg + jq and more provisioned binaries. Without CRAFT_WORKFLOW_E2E every describe below is reported skipped.
for (const name of WORKFLOW_SKILL_NAMES) {
  if (only && !only.includes(name)) continue;
  const recipes = fences(loadSkill(name).body).filter((f) => f.recipe);
  describe.skipIf(!workflowEnabled)(`${name} workflow recipes (real binaries)`, () => {
    it("has at least one recipe", () => expect(recipes.length).toBeGreaterThan(0));
    for (const r of recipes) {
      it(`X3 recipe ${r.recipe} runs and every verify passes`, () => {
        const { res } = runRecipe(r.code);
        expect(res.status, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`).toBe(0);
      }, 260_000);
    }
  });
}

describe.skipIf(!workflowEnabled)("craft-podcast-master gate (real binaries)", () => {
  it("X2 a source shorter than the reference stops at a failing duration gate and writes no master", () => {
    const recipe = fences(loadSkill("craft-podcast-master").body).find((f) => f.recipe === "podcast-master-core");
    expect(recipe).toBeTruthy();
    const { res, cwd } = runRecipe(recipe?.code ?? "", { SRC_DUR: "4" });
    expect(res.status, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`).not.toBe(0);
    expect(res.stdout + res.stderr).toMatch(/FAIL --duration\s+expected 5±0\.05\s+actual 4/);
    expect(fs.existsSync(path.join(cwd, "05-master", "master.wav"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, "07-delivery", "final.mp4"))).toBe(false);
  }, 260_000);
});

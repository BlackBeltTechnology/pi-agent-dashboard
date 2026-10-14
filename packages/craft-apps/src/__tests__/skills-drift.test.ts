/**
 * Nightly drift check against REAL binaries: every command id quoted in an app skill's code fences must exist in
 * the app's live command list (the version `pi-craft` provisions — latest unless `<APP>_VERSION` pins one).
 * The offline variant (recorded fixtures) lives in skills.test.ts.
 *
 *   CRAFT_E2E=1 [CRAFT_HOME=/tmp/craft-home] vitest run skills-drift
 *
 * See change: add-craft-apps-core (spec craft-app-skills "Skill drift check").
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { extractCommandIds } from "../command-ids.js";
import { CRAFT_APPS } from "../registry.js";
import { CRAFT_CLI, TSX } from "./helpers/paths.js";
import { fences, loadSkill, quotedIds } from "./helpers/skills.js";

const enabled = !!process.env.CRAFT_E2E;
const pi = (args: string[]) =>
  spawnSync(process.execPath, ["--import", TSX, CRAFT_CLI, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: "" }, timeout: 300_000 });

describe("extractCommandIds", () => {
  it("reads JSON rows (id, name, aliases) and text tables", () => {
    expect(extractCommandIds('[{"id":"a.b","aliases":["ab"]},{"name":"tool_x"}]')).toEqual(["a.b", "ab", "tool_x"]);
    expect(extractCommandIds("file.new   New\n  params: {}\nedit.undo*  Undo\n")).toEqual(["edit.undo", "file.new"]);
    expect(extractCommandIds("")).toEqual([]);
  });
});

describe.skipIf(!enabled)("skills vs live command lists (real binaries)", () => {
  for (const app of CRAFT_APPS) {
    it(`${app.id}: every quoted id exists in the live command list`, () => {
      const list = pi([app.id, "exec", ...app.dialect.list]);
      expect(list.status, list.stderr).toBe(0);
      const live = new Set(extractCommandIds(list.stdout));
      expect(live.size, `${app.id} listed no commands`).toBeGreaterThan(10);
      const namespaces = new Set([...live].map((i) => i.split(".")[0]));
      const version = /(\d+\.\d+\.\d+)/.exec(pi([app.id, "exec", "--version"]).stdout)?.[1] ?? "unknown";
      for (const f of fences(loadSkill(app.id).body)) {
        for (const id of quotedIds(f.code, namespaces)) expect(live.has(id), `${app.id} skill quotes "${id}", unknown to ${app.id} ${version}`).toBe(true);
      }
    }, 320_000);
  }
});

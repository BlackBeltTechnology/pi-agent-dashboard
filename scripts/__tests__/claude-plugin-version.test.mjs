/**
 * Version lockstep for the Claude plugin manifest.
 *
 *  - E40: `plugin.json` version equals the root `package.json` version.
 *  - E41: `sync-versions.js` stamps `plugin.json` and is idempotent.
 *  - E42: the local `release-cut` flow stages `plugin.json` and verifies the
 *    equality before `git tag`.
 *
 * See change: add-claude-code-plugin (design D9).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PLUGIN_JSON_REL = "packages/claude-plugin/.claude-plugin/plugin.json";
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("plugin.json version equals the root version (E40)", () => {
  it("is in lockstep", () => {
    const root = readJson(path.join(REPO_ROOT, "package.json")).version;
    const plugin = readJson(path.join(REPO_ROOT, PLUGIN_JSON_REL)).version;
    expect(plugin).toBe(root);
  });
});

describe("sync-versions.js stamps plugin.json (E41)", () => {
  /** A minimal repo skeleton: the real scripts, a root + one workspace, and the real plugin.json. */
  function skeleton(version) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-plugin-version-"));
    tmpDirs.push(dir);
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    for (const f of ["sync-versions.js", "sync-versions-spec.js"]) {
      fs.copyFileSync(path.join(REPO_ROOT, "scripts", f), path.join(dir, "scripts", f));
    }
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "root", version }, null, 2) + "\n");
    fs.mkdirSync(path.join(dir, "packages/a"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "packages/a/package.json"),
      JSON.stringify({ name: "a", version }, null, 2) + "\n",
    );
    fs.mkdirSync(path.join(dir, "packages/claude-plugin/.claude-plugin"), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, PLUGIN_JSON_REL), path.join(dir, PLUGIN_JSON_REL));
    return dir;
  }

  const run = (dir) => spawnSync("node", [path.join(dir, "scripts/sync-versions.js")], { encoding: "utf8" });

  it("rewrites the version and a second run changes nothing", () => {
    const dir = skeleton("9.9.9");
    const target = path.join(dir, PLUGIN_JSON_REL);
    expect(readJson(target).version).not.toBe("9.9.9");

    const first = run(dir);
    expect(first.status, first.stderr).toBe(0);
    expect(readJson(target).version).toBe("9.9.9");

    const before = fs.readFileSync(target, "utf8");
    const second = run(dir);
    expect(second.status, second.stderr).toBe(0);
    expect(fs.readFileSync(target, "utf8")).toBe(before);
  });

  it("changes only the version line of plugin.json", () => {
    const dir = skeleton("9.9.9");
    const target = path.join(dir, PLUGIN_JSON_REL);
    const original = fs.readFileSync(target, "utf8");
    run(dir);
    const stamped = fs.readFileSync(target, "utf8");
    const diff = stamped.split("\n").filter((line, i) => line !== original.split("\n")[i]);
    expect(diff).toEqual(['  "version": "9.9.9",']);
  });

  it("tolerates a repo without the plugin", () => {
    const dir = skeleton("9.9.9");
    fs.rmSync(path.join(dir, "packages/claude-plugin"), { recursive: true });
    expect(run(dir).status).toBe(0);
  });
});

describe("release-cut stages and verifies plugin.json (E42)", () => {
  const skill = fs.readFileSync(path.join(REPO_ROOT, ".pi/skills/release-cut/SKILL.md"), "utf8");
  const section = (n) => {
    const m = skill.match(new RegExp(`## Step ${n} [\\s\\S]*?(?=\\n## Step |$)`));
    expect(m, `Step ${n}`).toBeTruthy();
    return m[0];
  };

  it("step 6 git add includes plugin.json", () => {
    const addLine = section(6).split("\n").find((l) => l.startsWith("git add "));
    expect(addLine).toContain(PLUGIN_JSON_REL);
  });

  it("step 5's expected-diff text names plugin.json", () => {
    expect(section(5)).toContain(PLUGIN_JSON_REL);
  });

  it("a version-equality check precedes git tag", () => {
    const step7 = section(7);
    const check = step7.indexOf("plugin.json");
    const tag = step7.indexOf("git tag v");
    expect(check).toBeGreaterThan(-1);
    expect(tag).toBeGreaterThan(check);
  });
});

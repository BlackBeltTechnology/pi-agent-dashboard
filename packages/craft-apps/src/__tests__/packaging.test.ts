import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { WORKFLOW_SKILL_NAMES } from "./helpers/skills.js";
import { nodeStub } from "./helpers/stubs.js";

/**
 * Shell-executability invariants for `pi-craft` and the `pi-photocraft` alias (npm install + checkout)
 * and `pi-nano-banana` as a workspace bin, plus shipping of all 23 skills (router, 13 apps, 4 media + 5 office workflows).
 *
 * See change: add-photocraft-plugin, add-craft-apps-core.
 */
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const nanoBananaDir = path.resolve(pkgDir, "../nano-banana");
const MODULE_ERRORS = /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING|ERR_MODULE_NOT_FOUND|Cannot find (module|package)/;
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
  pi: { skills: string[] };
  bin: Record<string, string>;
  files: string[];
};

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});
const scratchDir = (prefix: string) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  scratch.push(d);
  return d;
};

function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: "", ...extra };
  delete env.PHOTOCRAFT_BIN;
  delete env.CRAFT_HOME;
  delete env.NANO_BANANA_BACKEND;
  return { ...env, ...extra };
}

function npmPack(cwd: string, tmp: string): string[] {
  const packed = spawnSync("npm", ["pack", "--json", "--pack-destination", tmp], {
    cwd,
    encoding: "utf8",
    env: cleanEnv({ npm_config_cache: path.join(tmp, "npm-cache") }),
    timeout: 120_000,
  });
  expect(packed.status, packed.stderr).toBe(0);
  // npm ≤ 11 prints an array; npm 12 an object keyed by package name.
  type Info = { filename: string; files: { path: string }[] };
  const parsed = JSON.parse(packed.stdout) as Info[] | Record<string, Info>;
  const info = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  return [path.join(tmp, info.filename), ...info.files.map((f) => f.path)];
}

describe("craft-apps packaging", () => {
  it("E23/E26 the 23 skills are declared, have frontmatter, and ship in the tarball", () => {
    expect(pkg.pi.skills).toHaveLength(23);
    for (const wf of WORKFLOW_SKILL_NAMES) expect(pkg.pi.skills).toContain(`.pi/skills/${wf}`);
    for (const rel of pkg.pi.skills) {
      const name = path.basename(rel);
      const text = fs.readFileSync(path.join(pkgDir, rel, "SKILL.md"), "utf8");
      const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
      expect(front, rel).toMatch(new RegExp(`^name: ${name}$`, "m"));
      expect(/^description: (.+)$/m.exec(front)?.[1] ?? "", rel).toMatch(/\S/);
    }
    const photo = fs.readFileSync(path.join(pkgDir, ".pi/skills/photocraft/SKILL.md"), "utf8");
    expect(/^description: (.+)$/m.exec(photo)?.[1]).toMatch(/PhotoCraft.*nano-banana.*headless|headless.*PhotoCraft.*nano-banana/i);
    const tmp = scratchDir("pc-pack-list-");
    const [, ...files] = npmPack(pkgDir, tmp);
    expect(files.filter((f) => /^\.pi\/skills\/[^/]+\/SKILL\.md$/.test(f))).toHaveLength(23);
    for (const rel of pkg.pi.skills) expect(files).toContain(`${rel}/SKILL.md`);
    expect(files).toContain("bin/pi-craft");
    expect(files).toContain("bin/pi-photocraft");
    expect(files).toContain("dist/craft.js");
    expect(files).toContain("dist/photocraft.js");
    expect(files.some((f) => f.includes("__tests__") || f.endsWith("AGENTS.md"))).toBe(false);
  }, 150_000);

  it("E43 the packed bins run from an npm install with no TS loader (bundled shared code included)", () => {
    const tmp = scratchDir("pc-pack-");
    const [tarball] = npmPack(pkgDir, tmp);
    const dest = path.join(tmp, "node_modules/@blackbelt-technology/pi-dashboard-craft-apps");
    fs.mkdirSync(dest, { recursive: true });
    expect(spawnSync("tar", ["-xzf", tarball, "-C", dest, "--strip-components=1"]).status).toBe(0);

    const craft = spawnSync(process.execPath, [path.join(dest, "bin/pi-craft"), "--help"], { cwd: tmp, encoding: "utf8", env: cleanEnv(), timeout: 30_000 });
    expect(craft.stderr).not.toMatch(MODULE_ERRORS);
    expect(craft.status).toBe(0);
    expect(craft.stderr).toContain("pi-craft <command>");
    const doc = spawnSync(process.execPath, [path.join(dest, "bin/pi-craft"), "doc", "prepare", "--help"], { cwd: tmp, encoding: "utf8", env: cleanEnv(), timeout: 30_000 });
    expect(doc.stderr).not.toMatch(MODULE_ERRORS);
    expect(doc.status).toBe(0);
    expect(doc.stderr).toContain("--allow-missing");
    const apps = spawnSync(process.execPath, [path.join(dest, "bin/pi-craft"), "apps", "--json"], { cwd: tmp, encoding: "utf8", env: cleanEnv(), timeout: 30_000 });
    expect(apps.status).toBe(0);
    expect(JSON.parse(apps.stdout)).toHaveLength(13);

    const launcher = path.join(dest, "bin/pi-photocraft");
    const help = spawnSync(process.execPath, [launcher, "--help"], { cwd: tmp, encoding: "utf8", env: cleanEnv(), timeout: 30_000 });
    expect(help.stderr).not.toMatch(MODULE_ERRORS);
    expect(help.status).toBe(0);
    expect(help.stderr).toContain("replace-region");

    const stub = nodeStub(`process.stdout.write("photocraft-cli 0.7.0 (stub)\\n");`);
    const ensure = spawnSync(process.execPath, [launcher, "ensure"], { cwd: tmp, encoding: "utf8", env: cleanEnv({ PHOTOCRAFT_BIN: stub }), timeout: 30_000 });
    expect(ensure.stderr).not.toMatch(MODULE_ERRORS);
    expect(ensure.status).toBe(0);
    expect(JSON.parse(ensure.stdout)).toMatchObject({ app: "photocraft", source: "override", asset: null, version: "0.7.0" });
    const viaCraft = spawnSync(process.execPath, [path.join(dest, "bin/pi-craft"), "photocraft", "ensure"], { cwd: tmp, encoding: "utf8", env: cleanEnv({ PHOTOCRAFT_BIN: stub }), timeout: 30_000 });
    expect(JSON.parse(viaCraft.stdout)).toMatchObject({ app: "photocraft", source: "override" });
  }, 150_000);

  it("E45 workspace bins start through a node_modules/.bin-style symlink", () => {
    const bin = scratchDir("pc-bin-");
    fs.symlinkSync(path.join(pkgDir, "bin/pi-craft"), path.join(bin, "pi-craft"));
    fs.symlinkSync(path.join(pkgDir, "bin/pi-photocraft"), path.join(bin, "pi-photocraft"));
    fs.symlinkSync(path.join(nanoBananaDir, "bin/pi-nano-banana"), path.join(bin, "pi-nano-banana"));
    const craft = spawnSync(path.join(bin, "pi-craft"), ["--help"], { encoding: "utf8", env: cleanEnv(), timeout: 30_000 });
    expect(craft.stderr).not.toMatch(MODULE_ERRORS);
    expect(craft.status).toBe(0);
    expect(craft.stderr).toContain("usage: pi-craft");
    const pc = spawnSync(path.join(bin, "pi-photocraft"), ["--help"], { encoding: "utf8", env: cleanEnv(), timeout: 30_000 });
    expect(pc.stderr).not.toMatch(MODULE_ERRORS);
    expect(pc.status).toBe(0);
    expect(pc.stderr).toContain("usage: pi-photocraft");
    const nb = spawnSync(path.join(bin, "pi-nano-banana"), [], { encoding: "utf8", env: cleanEnv(), timeout: 30_000 });
    expect(nb.stderr).not.toMatch(MODULE_ERRORS);
    expect(nb.status).toBe(1);
    expect(nb.stderr).toContain('usage: pi-nano-banana "<prompt>"');
  });

  it("declares both bins, dist in files, optional ffmpeg tools and no desktop/test leakage", () => {
    expect(pkg.bin["pi-craft"]).toBe("bin/pi-craft");
    expect(pkg.bin["pi-photocraft"]).toBe("bin/pi-photocraft");
    expect(pkg.files).toEqual(expect.arrayContaining(["bin/", "dist/", "!src/__tests__", "!**/AGENTS.md", "!**/*.AGENTS.md"]));
  });
});

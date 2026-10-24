/**
 * Shell-executability and shipping invariants for `pi-blender`: the tarball lists the built bundles,
 * launcher and skill and nothing else that is private; an `npm install` of the tarball runs
 * `pi-blender` from a plain shell with no TypeScript loader.
 *
 * See change: add-blender-wasm-mcp (test-plan E67, E56; tasks 5.3, 5.14).
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { PIN } from "../pin.js";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODULE_ERRORS = /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING|ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION|Cannot find (module|package)/;
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  pi: { skills: string[] };
  bin: Record<string, string>;
  files: string[];
};

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});
const scratchDir = (prefix: string): string => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  scratch.push(d);
  return d;
};

/** A plain shell environment: no loader, no inherited runtime overrides. */
function cleanEnv(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: "", HOME: home, USERPROFILE: home };
  for (const k of Object.keys(env)) if (k.startsWith("BLENDER_WASM_")) delete env[k];
  return { ...env, BLENDER_WASM_HOME: path.join(home, "cache"), ...extra };
}

function npmPack(tmp: string): { tarball: string; files: string[] } {
  const packed = spawnSync("npm", ["pack", "--json", "--pack-destination", tmp], {
    cwd: pkgDir,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: path.join(tmp, "npm-cache") },
    timeout: 180_000,
    shell: process.platform === "win32",
  });
  expect(packed.status, packed.stderr).toBe(0);
  // npm ≤ 11 prints an array; npm 12 an object keyed by package name.
  type Info = { filename: string; files: { path: string }[] };
  const parsed = JSON.parse(packed.stdout) as Info[] | Record<string, Info>;
  const info = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  return { tarball: path.join(tmp, info.filename), files: info.files.map((f) => f.path) };
}

// One pack per file: it runs `prepack` (esbuild) and is the slow step.
let packed: { tmp: string; tarball: string; files: string[] } | undefined;
function packOnce() {
  if (!packed) {
    const tmp = scratchDir("blender-pack-");
    packed = { tmp, ...npmPack(tmp) };
  }
  return packed;
}

describe("blender packaging", () => {
  it("E67/5.3: the manifest declares the pi-blender bin, the skill, dist and no test/desktop leakage", () => {
    expect(pkg.bin["pi-blender"]).toBe("bin/pi-blender");
    expect(pkg.pi.skills).toEqual([".pi/skills/blender"]);
    expect(pkg.files).toEqual(expect.arrayContaining(["bin/", "dist/", ".pi/skills/", "README.md", "!src/__tests__", "!**/AGENTS.md", "!**/*.AGENTS.md"]));
    const front = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(pkgDir, pkg.pi.skills[0], "SKILL.md"), "utf8"))?.[1] ?? "";
    expect(front).toMatch(/^name: blender$/m);
  });

  it("E67/5.3: `npm pack` lists dist/blender.js, dist/host.js, dist/worker-boot.cjs, the launcher, the skill and the README — and no tests or AGENTS.md", () => {
    const { files } = packOnce();
    for (const f of ["dist/blender.js", "dist/host.js", "dist/worker-boot.cjs", "bin/pi-blender", ".pi/skills/blender/SKILL.md", "README.md", "package.json", "src/host/worker-boot.cjs"]) {
      expect(files, f).toContain(f);
    }
    expect(files.some((f) => f.includes("__tests__") || /(^|\/)AGENTS\.md$/.test(f) || f.endsWith(".AGENTS.md"))).toBe(false);
    expect(files.filter((f) => f.startsWith("src/") && f.endsWith(".test.ts"))).toEqual([]);
  }, 200_000);

  it("E67/5.3: the bundles are self-contained — no bare import of a workspace package, and worker-boot.cjs is the verbatim CommonJS copy", () => {
    const tmp = scratchDir("blender-bundle-");
    const { tarball } = packOnce();
    expect(spawnSync("tar", ["-xzf", tarball, "-C", tmp, "--strip-components=1"]).status).toBe(0);
    for (const f of ["blender.js", "host.js"]) {
      const text = fs.readFileSync(path.join(tmp, "dist", f), "utf8");
      expect(text, f).not.toMatch(/from\s+["']@blackbelt-technology\//);
      expect(text, f).not.toMatch(/require\(["']@blackbelt-technology\//);
      expect(text.startsWith("#!/usr/bin/env node"), f).toBe(true);
    }
    expect(fs.readFileSync(path.join(tmp, "dist", "worker-boot.cjs"), "utf8")).toBe(fs.readFileSync(path.join(pkgDir, "src", "host", "worker-boot.cjs"), "utf8"));
  }, 200_000);

  it("E67: an npm install of the tarball into a temp prefix runs `pi-blender status` from a plain shell (no tsx): exit 0 with a status report", () => {
    const { tarball, tmp } = packOnce();
    const prefix = path.join(tmp, "prefix");
    fs.mkdirSync(prefix);
    // `@blackbelt-technology/pi-dashboard-shared` is bundled into dist by esbuild, so the shipped code never
    // loads it. npm still wants to resolve the declared dependency; point it at an empty local stub so the
    // install is offline and the run below proves the bundle does not need the real package.
    const sharedName = "@blackbelt-technology/pi-dashboard-shared";
    expect(Object.keys(pkg.dependencies)).toEqual([sharedName]);
    const stub = path.join(tmp, "shared-stub");
    fs.mkdirSync(stub);
    fs.writeFileSync(path.join(stub, "package.json"), JSON.stringify({ name: sharedName, version: pkg.version }));
    fs.writeFileSync(path.join(prefix, "package.json"), JSON.stringify({ name: "blender-install-smoke", private: true, overrides: { [sharedName]: `file:${stub}` } }));
    const install = spawnSync("npm", ["install", "--prefix", prefix, tarball, "--ignore-scripts", "--no-audit", "--no-fund", "--offline"], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: path.join(tmp, "npm-cache") },
      timeout: 180_000,
      shell: process.platform === "win32",
    });
    expect(install.status, `${install.stdout}\n${install.stderr}`).toBe(0);
    const installed = path.join(prefix, "node_modules", ...pkg.name.split("/"));
    expect(fs.existsSync(path.join(installed, "dist", "blender.js"))).toBe(true);
    expect(fs.existsSync(path.join(prefix, "node_modules", "tsx"))).toBe(false);
    expect(fs.readdirSync(path.join(prefix, "node_modules", ...sharedName.split("/")))).toEqual(["package.json"]);

    const home = scratchDir("blender-home-");
    const cwd = scratchDir("blender-cwd-");
    // POSIX: the .bin shim a user's shell resolves. Windows: npm writes a .cmd shim; run the launcher through node instead.
    const [cmd, argv] = process.platform === "win32" ? [process.execPath, [path.join(installed, "bin", "pi-blender")]] : [path.join(prefix, "node_modules", ".bin", "pi-blender"), []];
    if (process.platform !== "win32") expect(fs.existsSync(cmd)).toBe(true);

    const status = spawnSync(cmd, [...argv, "status"], { cwd, encoding: "utf8", env: cleanEnv(home), timeout: 120_000 });
    expect(status.stderr).not.toMatch(MODULE_ERRORS);
    expect(status.status, status.stderr).toBe(0);
    expect(status.stdout).toContain(`pinned runtime: ${PIN.version} — not cached`);
    expect(status.stdout).toContain(`cache root: ${path.join(home, "cache")}`);
    expect(status.stdout).toMatch(/^JSPI: (native|flag|unavailable) \(Node v\d+/m);
    expect(fs.existsSync(path.join(home, "cache"))).toBe(false);

    const json = spawnSync(cmd, [...argv, "status", "--json"], { cwd, encoding: "utf8", env: cleanEnv(home), timeout: 120_000 });
    expect(json.status, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ pinned: { version: PIN.version, cached: false }, source: "managed" });

    const help = spawnSync(cmd, [...argv, "--help"], { cwd, encoding: "utf8", env: cleanEnv(home), timeout: 120_000 });
    expect(help.stderr).not.toMatch(MODULE_ERRORS);
    expect(help.status).toBe(0);
    expect(help.stderr).toContain("usage: pi-blender");

    const bad = spawnSync(cmd, [...argv, "render"], { cwd, encoding: "utf8", env: cleanEnv(home), timeout: 120_000 });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("usage: pi-blender");
    expect(fs.existsSync(path.join(cwd, ".pi"))).toBe(false);
  }, 400_000);

  it("E67: the installed `mcp --register` writes an entry whose launcher exists", () => {
    const { tmp } = packOnce();
    const installed = path.join(tmp, "prefix", "node_modules", ...pkg.name.split("/"));
    expect(fs.existsSync(installed), "the install test above must have run (do not filter it out)").toBe(true);
    const home = scratchDir("blender-home-");
    const cwd = scratchDir("blender-cwd-");
    fs.mkdirSync(path.join(cwd, ".git"));
    const r = spawnSync(process.execPath, [path.join(installed, "bin", "pi-blender"), "mcp", "--register"], { cwd, encoding: "utf8", env: cleanEnv(home), timeout: 120_000 });
    expect(r.status, r.stderr).toBe(0);
    const cfg = JSON.parse(fs.readFileSync(path.join(cwd, ".pi", "mcp.json"), "utf8")) as { mcpServers: Record<string, { command: string; args: string[] }> };
    const entry = cfg.mcpServers["blender-wasm"];
    expect(entry.command).toBe(process.execPath);
    expect(entry.args.at(-1)).toBe("mcp");
    expect(fs.realpathSync(entry.args[0])).toBe(fs.realpathSync(path.join(installed, "bin", "pi-blender")));
  }, 150_000);
});

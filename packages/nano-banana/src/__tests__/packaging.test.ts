import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The `pi-nano-banana` bin must start from a plain shell — from a monorepo
 * checkout and from an npm install — with no TypeScript loader configured.
 * A raw-TS bin fails both ways (ERR_MODULE_NOT_FOUND / ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING).
 *
 * See change: add-photocraft-plugin.
 */
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODULE_ERRORS = /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING|ERR_MODULE_NOT_FOUND|Cannot find (module|package)/;
const USAGE_LINE = 'usage: pi-nano-banana "<prompt>"';

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});

function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra, NODE_OPTIONS: "" };
  delete env.NANO_BANANA_BACKEND;
  return env;
}

describe("pi-nano-banana packaging", () => {
  it("E44 bin runs from an npm install (no TS loader)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-pack-"));
    scratch.push(tmp);
    const packed = spawnSync("npm", ["pack", "--silent", "--pack-destination", tmp], {
      cwd: pkgDir,
      encoding: "utf8",
      env: cleanEnv({ npm_config_cache: path.join(tmp, "npm-cache") }),
      timeout: 120_000,
    });
    expect(packed.status, packed.stderr).toBe(0);
    const tarball = path.join(tmp, packed.stdout.trim().split("\n").pop() as string);

    const dest = path.join(tmp, "node_modules/@blackbelt-technology/pi-dashboard-nano-banana");
    fs.mkdirSync(dest, { recursive: true });
    const untar = spawnSync("tar", ["-xzf", tarball, "-C", dest, "--strip-components=1"], { encoding: "utf8" });
    expect(untar.status, untar.stderr).toBe(0);
    expect(fs.existsSync(path.join(dest, "dist/nano-banana.js"))).toBe(true);

    const r = spawnSync(process.execPath, [path.join(dest, "bin/pi-nano-banana")], {
      cwd: tmp,
      encoding: "utf8",
      env: cleanEnv(),
      timeout: 30_000,
    });
    expect(r.stderr).not.toMatch(MODULE_ERRORS);
    expect(r.stderr).toContain(USAGE_LINE);
    expect(r.status).toBe(1);
  }, 150_000);

  it("workspace launcher runs from the checkout and passes the exit code through", () => {
    const r = spawnSync(process.execPath, [path.join(pkgDir, "bin/pi-nano-banana")], {
      encoding: "utf8",
      env: cleanEnv(),
      timeout: 30_000,
    });
    expect(r.stderr).not.toMatch(MODULE_ERRORS);
    expect(r.stderr).toContain(USAGE_LINE);
    expect(r.status).toBe(1);
  });

  it("package.json points the bin at the launcher and ships bin/ + dist/", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    expect(pkg.bin["pi-nano-banana"]).toBe("bin/pi-nano-banana");
    expect(pkg.files).toEqual(expect.arrayContaining(["bin/", "dist/"]));
    expect(pkg.scripts.prepack).toBe("node scripts/build.mjs");
    expect(pkg.exports["./*.js"]).toBe("./src/*.ts");
  });
});

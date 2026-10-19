/**
 * test-plan E9 / X2 (refresh-electron-bundled-components, design D7): the
 * packaged-app symlink scan. Fails on any absolute, dangling or app-root-escaping
 * link; passes a tree holding only valid in-bundle relative links.
 *
 * Skipped on win32 (symlink creation needs elevated rights); the win32 CI legs run
 * the scan script itself over the real package output.
 *
 * See change: refresh-electron-bundled-components.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module, no type declarations by design.
import { scanPackagedSymlinks } from "../../scripts/scan-packaged-symlinks.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/scan-packaged-symlinks.mjs");

let tmp: string;
let appRoot: string;
let resources: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "scan-links-")));
  appRoot = path.join(tmp, "App");
  resources = path.join(appRoot, "resources");
  fs.mkdirSync(path.join(resources, "server", "lib"), { recursive: true });
  fs.writeFileSync(path.join(resources, "server", "lib", "real.js"), "x");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe.skipIf(process.platform === "win32")("scanPackagedSymlinks", () => {
  it("E9: reports exactly the absolute, dangling and root-escaping links; a valid link is clean", () => {
    const bin = path.join(resources, "server", "bin");
    fs.mkdirSync(bin);
    fs.symlinkSync(path.join(resources, "server", "lib", "real.js"), path.join(bin, "abs")); // (a) absolute
    fs.symlinkSync("../lib/missing.js", path.join(bin, "dangling")); // (b) dangling
    fs.writeFileSync(path.join(tmp, "host-file"), "x");
    fs.symlinkSync("../../../../host-file", path.join(bin, "escape")); // (c) escapes via ../../
    fs.symlinkSync("../lib/real.js", path.join(bin, "ok")); // (d) valid

    const problems = scanPackagedSymlinks({ scanDir: resources, appRoot });
    const byName = Object.fromEntries(problems.map((p: { link: string; reason: string }) => [path.basename(p.link), p.reason]));

    expect(byName).toEqual({ abs: "absolute", dangling: "dangling", escape: "escapes-app-root" });
  });

  it("a tree with only a valid relative link has no problems", () => {
    const bin = path.join(resources, "server", "bin");
    fs.mkdirSync(bin);
    fs.symlinkSync("../lib/real.js", path.join(bin, "ok"));
    expect(scanPackagedSymlinks({ scanDir: resources, appRoot })).toEqual([]);
  });

  it("X2: the CLI exits non-zero naming the bad link, and 0 on a clean tree", () => {
    const bin = path.join(resources, "server", "bin");
    fs.mkdirSync(bin);
    fs.symlinkSync("../lib/real.js", path.join(bin, "ok"));
    const clean = spawnSync(process.execPath, [SCRIPT, resources, appRoot], { encoding: "utf8" });
    expect(clean.status).toBe(0);

    fs.symlinkSync("/usr/bin/env", path.join(bin, "abs"));
    const dirty = spawnSync(process.execPath, [SCRIPT, resources, appRoot], { encoding: "utf8" });
    expect(dirty.status).toBe(1);
    expect(dirty.stderr).toContain("symlink absolute: server/bin/abs");
  });

  it("CLI exits 2 on a missing scan dir", () => {
    const r = spawnSync(process.execPath, [SCRIPT, path.join(tmp, "nope")], { encoding: "utf8" });
    expect(r.status).toBe(2);
  });
});

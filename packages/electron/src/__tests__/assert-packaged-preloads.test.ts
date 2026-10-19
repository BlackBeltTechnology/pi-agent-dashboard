/**
 * test-plan E2 (refresh-electron-bundled-components, design D7): the post-build
 * preload check passes only when BOTH `preload.js` and `preload-main.js` exist;
 * deleting either makes it exit non-zero naming the missing file.
 *
 * The CI-wiring half (the check runs on every electron leg, and the symlink scan
 * and darwin strict-codesign guards too) is asserted against the workflow text.
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
import { missingPreloads } from "../../scripts/assert-packaged-preloads.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, "../../scripts/assert-packaged-preloads.mjs");
const WORKFLOW = fs.readFileSync(path.resolve(here, "../../../../.github/workflows/_electron-build.yml"), "utf8");

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "preloads-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const run = () => spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" });

describe("assert-packaged-preloads (E2)", () => {
  it("passes when both preload files exist", () => {
    fs.writeFileSync(path.join(dir, "preload.js"), "");
    fs.writeFileSync(path.join(dir, "preload-main.js"), "");
    expect(missingPreloads(dir)).toEqual([]);
    expect(run().status).toBe(0);
  });

  it.each(["preload.js", "preload-main.js"])("fails naming %s when it is missing", (missing) => {
    for (const f of ["preload.js", "preload-main.js"]) {
      if (f !== missing) fs.writeFileSync(path.join(dir, f), "");
    }
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`missing preload ${missing}`);
  });

  it("fails when Forge emitted .cjs names instead (the Forge 8 default)", () => {
    fs.writeFileSync(path.join(dir, "preload.cjs"), "");
    fs.writeFileSync(path.join(dir, "preload-main.cjs"), "");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("preload.cjs");
  });
});

describe("workflow wires the packaging guards on every electron leg (D7)", () => {
  /** Body of the named step (up to the next `- name:` at step indentation). */
  function stepBody(name: string): string {
    const marks = [...WORKFLOW.matchAll(/^ {6}- name: (.+)$/gm)];
    const i = marks.findIndex((m) => m[1].trim().startsWith(name));
    expect(i, `step "${name}" not found`).toBeGreaterThanOrEqual(0);
    const end = i + 1 < marks.length ? marks[i + 1].index : WORKFLOW.length;
    return WORKFLOW.slice(marks[i].index, end);
  }

  it("darwin: symlink scan + preload check + strict codesign run after forge package", () => {
    const body = stepBody("Make Electron distributables (macOS)");
    expect(body).toContain("scan-packaged-symlinks.mjs");
    expect(body).toContain("assert-packaged-preloads.mjs");
    expect(body).toContain("codesign-strict-check.sh");
    expect(body.indexOf("electron-forge package")).toBeLessThan(body.indexOf("scan-packaged-symlinks.mjs"));
  });

  it("linux: symlink scan + preload check run after forge make", () => {
    const body = stepBody("Make Electron distributables (Linux)");
    expect(body).toContain("scan-packaged-symlinks.mjs");
    expect(body).toContain("assert-packaged-preloads.mjs");
    expect(body.indexOf("electron-forge make")).toBeLessThan(body.indexOf("scan-packaged-symlinks.mjs"));
  });

  it("win32: symlink scan + preload check run after forge package", () => {
    const body = stepBody("Package Electron (Windows");
    expect(body).toContain("scan-packaged-symlinks.mjs");
    expect(body).toContain("assert-packaged-preloads.mjs");
    expect(body.indexOf("electron-forge.cmd package")).toBeLessThan(body.indexOf("scan-packaged-symlinks.mjs"));
  });
});

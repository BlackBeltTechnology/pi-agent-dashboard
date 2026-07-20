/**
 * Unit tests for packages/electron/scripts/assert-bundled-plugins-complete.mjs
 * (change: add-nightly-verdaccio-build, task 2.3 + scenario 7.1-guard).
 *
 * Drives the script as a subprocess against synthetic PACKAGES_DIR /
 * BUNDLE_PLUGINS_DIR fixtures (env-overridable), asserting:
 *   - a fixture-only plugin (manifest.fixture === true) is NOT required;
 *   - a runtime plugin missing from the bundle → non-zero exit + names it;
 *   - a complete bundle → exit 0.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(
  REPO_ROOT,
  "packages",
  "electron",
  "scripts",
  "assert-bundled-plugins-complete.mjs",
);

let tmp;

function makePluginPkg(packagesDir, dir, manifest) {
  const d = path.join(packagesDir, dir);
  mkdirSync(d, { recursive: true });
  writeFileSync(
    path.join(d, "package.json"),
    JSON.stringify(
      { name: `@x/${dir}`, version: "0.0.0", "pi-dashboard-plugin": manifest },
      null,
      2,
    ),
  );
}

function makeBundledPlugin(bundleDir, dir) {
  mkdirSync(path.join(bundleDir, dir), { recursive: true });
}

function run(packagesDir, bundleDir) {
  return spawnSync("node", [SCRIPT], {
    env: {
      ...process.env,
      PACKAGES_DIR: packagesDir,
      BUNDLE_PLUGINS_DIR: bundleDir,
    },
    encoding: "utf8",
  });
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "assert-plugins-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("assert-bundled-plugins-complete", () => {
  it("exits 0 when the bundle contains every runtime plugin (fixture ignored)", () => {
    const packagesDir = path.join(tmp, "packages");
    const bundleDir = path.join(tmp, "bundle");
    mkdirSync(packagesDir, { recursive: true });
    makePluginPkg(packagesDir, "alpha-plugin", { id: "alpha" });
    makePluginPkg(packagesDir, "beta-plugin", { id: "beta" });
    makePluginPkg(packagesDir, "demo-plugin", { id: "demo", fixture: true });
    // Bundle has the two runtime plugins but NOT the fixture — still green.
    makeBundledPlugin(bundleDir, "alpha-plugin");
    makeBundledPlugin(bundleDir, "beta-plugin");

    const r = run(packagesDir, bundleDir);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("demo-plugin");
  });

  it("exits non-zero and names the plugin missing from the bundle", () => {
    const packagesDir = path.join(tmp, "packages");
    const bundleDir = path.join(tmp, "bundle");
    mkdirSync(packagesDir, { recursive: true });
    makePluginPkg(packagesDir, "alpha-plugin", { id: "alpha" });
    makePluginPkg(packagesDir, "kb-plugin", { id: "kb" });
    // Bundle omits kb-plugin — the exact regression this gate closes.
    makeBundledPlugin(bundleDir, "alpha-plugin");

    const r = run(packagesDir, bundleDir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("kb-plugin");
    expect(r.stderr).not.toContain("alpha-plugin,"); // alpha not in the missing list
  });

  it("a fixture plugin absent from the bundle does NOT fail the gate", () => {
    const packagesDir = path.join(tmp, "packages");
    const bundleDir = path.join(tmp, "bundle");
    mkdirSync(packagesDir, { recursive: true });
    makePluginPkg(packagesDir, "alpha-plugin", { id: "alpha" });
    makePluginPkg(packagesDir, "demo-plugin", { id: "demo", fixture: true });
    makeBundledPlugin(bundleDir, "alpha-plugin"); // demo intentionally absent

    const r = run(packagesDir, bundleDir);
    expect(r.status).toBe(0);
  });
});

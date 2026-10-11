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

// BUNDLE_ROOT_DIR is always explicit so the default (dirname(dirname(
// BUNDLE_PLUGINS_DIR))) can never resolve against the shared os temp root
// (test-plan #E18). See change: bundle-plugin-third-party-deps.
function run(packagesDir, bundleDir, bundleRootDir = path.join(tmp, "bundle-root")) {
  return spawnSync("node", [SCRIPT], {
    env: {
      ...process.env,
      PACKAGES_DIR: packagesDir,
      BUNDLE_PLUGINS_DIR: bundleDir,
      BUNDLE_ROOT_DIR: bundleRootDir,
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

  // Resolvability: every declared dep of every bundled plugin must resolve
  // inside the bundle root. See change: bundle-plugin-third-party-deps (D4).
  describe("plugin dependency resolvability", () => {
    /** Bundle fixture: root/resources/plugins/gmail-plugin declaring oauth4webapi. */
    function gmailFixture() {
      const packagesDir = path.join(tmp, "packages");
      const root = path.join(tmp, "parent", "root");
      const pluginsDir = path.join(root, "resources", "plugins");
      mkdirSync(packagesDir, { recursive: true });
      makePluginPkg(packagesDir, "gmail-plugin", { id: "gmail" });
      mkdirSync(path.join(pluginsDir, "gmail-plugin"), { recursive: true });
      writeFileSync(
        path.join(pluginsDir, "gmail-plugin", "package.json"),
        JSON.stringify({ name: "@x/gmail-plugin", dependencies: { oauth4webapi: "^3.8.8" } }),
      );
      return { packagesDir, root, pluginsDir };
    }
    const install = (nmParent, name, version) => {
      mkdirSync(path.join(nmParent, "node_modules", name), { recursive: true });
      writeFileSync(path.join(nmParent, "node_modules", name, "package.json"), JSON.stringify({ name, version }));
    };

    it("fails naming the plugin → dep pair when a declared dep is absent (test-plan #E15)", () => {
      const { packagesDir, root, pluginsDir } = gmailFixture();
      const r = run(packagesDir, pluginsDir, root);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("gmail-plugin → oauth4webapi");
    });

    it("does not accept a dep that resolves only above the bundle root (test-plan #E16)", () => {
      const { packagesDir, root, pluginsDir } = gmailFixture();
      install(path.dirname(root), "oauth4webapi", "3.8.8");
      const r = run(packagesDir, pluginsDir, root);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("gmail-plugin → oauth4webapi");
    });

    it("passes and prints the installed version when the dep is at the bundle root (test-plan #E17)", () => {
      const { packagesDir, root, pluginsDir } = gmailFixture();
      install(root, "oauth4webapi", "3.8.8");
      const r = run(packagesDir, pluginsDir, root);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("oauth4webapi@3.8.8");
    });
  });
});

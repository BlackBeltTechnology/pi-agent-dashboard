import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import forgeConfig from "../../forge.config.js";
import {
  materializeBundledPlugins,
  readBundledPluginIds,
} from "../../../shared/src/runtime-overlay/materialize-plugins.mjs";

/**
 * Build-config parity lint (change: fix-electron-auto-update-pipeline, §3.6).
 *
 * The packaged app's `app-update.yml` is written by electron-builder while the
 * .app / .deb originate from Forge. Auto-update breaks if the two toolchains
 * disagree on identity fields (appId drives the NSIS install identity + the
 * electron-updater cache dir). This test fails on drift between:
 *   - forge.config.ts          (Forge: packagerConfig)
 *   - electron-builder.yml     (electron-builder: mac DMG + linux AppImage)
 *   - electron-builder-nsis.json (electron-builder: Windows NSIS)
 */
const electronRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const eb = parseYaml(readFileSync(path.join(electronRoot, "electron-builder.yml"), "utf8"));
const nsis = JSON.parse(readFileSync(path.join(electronRoot, "electron-builder-nsis.json"), "utf8"));
const pkg = forgeConfig.packagerConfig ?? {};

const CANONICAL_APP_ID = "com.blackbelt-technology.pi-dashboard";
const CANONICAL_EXECUTABLE = "pi-dashboard";
const CANONICAL_PRODUCT = "PI Dashboard";

describe("build-config parity", () => {
  it("all three configs declare the same appId", () => {
    expect(pkg.appBundleId).toBe(CANONICAL_APP_ID);
    expect(eb.appId).toBe(CANONICAL_APP_ID);
    expect(nsis.appId).toBe(CANONICAL_APP_ID);
  });

  it("all three configs declare the same executable name", () => {
    expect(pkg.executableName).toBe(CANONICAL_EXECUTABLE);
    expect(eb.executableName).toBe(CANONICAL_EXECUTABLE);
    expect(nsis.executableName).toBe(CANONICAL_EXECUTABLE);
  });

  it("electron-builder configs agree on productName", () => {
    expect(eb.productName).toBe(CANONICAL_PRODUCT);
    expect(nsis.productName).toBe(CANONICAL_PRODUCT);
  });

  it("icon paths all resolve to the resources/icon family", () => {
    // Forge uses an extensionless base ("resources/icon"); electron-builder
    // needs the concrete .icns / .png. All must share the `icon` basename.
    expect(path.basename(String(pkg.icon))).toBe("icon");
    expect(path.basename(eb.mac.icon, ".icns")).toBe("icon");
    expect(path.basename(eb.linux.icon, ".png")).toBe("icon");
    expect(String(nsis.win.icon)).toContain("installer-icon");
  });

  it("electron-builder configs target the same GitHub release stream", () => {
    for (const cfg of [eb, nsis]) {
      expect(cfg.publish.provider).toBe("github");
      expect(cfg.publish.owner).toBe("BlackBeltTechnology");
      expect(cfg.publish.repo).toBe("pi-agent-dashboard");
    }
  });
});

/**
 * Single first-party plugin list (change: electron-runtime-overlay-updates,
 * test-plan E22). `packages/server/package.json#piDashboard.bundledPlugins` is
 * the ONE list: `bundle-server.mjs` (the bundle) and the runtime-overlay
 * stager both derive it through the shared `materialize-plugins.mjs` helper.
 */
describe("bundled plugin list — single source of truth (E22)", () => {
  const repoRoot = path.resolve(electronRoot, "..", "..");
  const serverPkgPath = path.join(repoRoot, "packages", "server", "package.json");
  const bundleScript = readFileSync(path.join(electronRoot, "scripts", "bundle-server.mjs"), "utf8");

  it("server package.json declares piDashboard.bundledPlugins as a non-empty id list", () => {
    const ids = readBundledPluginIds(serverPkgPath);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(existsSync(path.join(repoRoot, "packages", id, "package.json"))).toBe(true);
    }
  });

  it("bundle-server.mjs carries no hardcoded plugin list and derives it via the shared helper", () => {
    expect(bundleScript).not.toMatch(/const BUNDLED_PLUGINS\s*=\s*\[/);
    expect(bundleScript).toContain("readBundledPluginIds(");
    expect(bundleScript).toContain("materializeBundledPlugins(");
  });

  it("the materialize helper copies exactly the declared ids; removing one removes it", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "e22-"));
    try {
      const src = path.join(tmp, "packages");
      for (const id of ["a-plugin", "b-plugin", "c-plugin", "fixture-plugin"]) {
        mkdirSync(path.join(src, id, "node_modules", "dep"), { recursive: true });
        writeFileSync(
          path.join(src, id, "package.json"),
          JSON.stringify({ name: id, ...(id === "fixture-plugin" ? { "pi-dashboard-plugin": { fixture: true } } : {}) }),
        );
      }
      const pkg = path.join(tmp, "server-package.json");
      const declare = (ids: string[]) =>
        writeFileSync(pkg, JSON.stringify({ piDashboard: { bundledPlugins: ids } }));
      const run = (dest: string) =>
        materializeBundledPlugins({
          ids: readBundledPluginIds(pkg),
          resolveSource: (id: string) => path.join(src, id),
          destDir: dest,
        });

      declare(["a-plugin", "b-plugin", "c-plugin", "fixture-plugin"]);
      const full = path.join(tmp, "full");
      expect(run(full)).toEqual(["a-plugin", "b-plugin", "c-plugin"]);
      expect(readdirSync(full).sort()).toEqual(["a-plugin", "b-plugin", "c-plugin"]);
      // node_modules never copied into the materialized plugin.
      expect(readdirSync(path.join(full, "a-plugin"))).toEqual(["package.json"]);

      declare(["a-plugin", "c-plugin"]);
      const reduced = path.join(tmp, "reduced");
      expect(run(reduced)).toEqual(["a-plugin", "c-plugin"]);
      expect(readdirSync(reduced).sort()).toEqual(["a-plugin", "c-plugin"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("copies a plugin whose SOURCE lives under node_modules (runtime overlay), still skipping its own nested node_modules", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "e22-nm-"));
    try {
      const src = path.join(tmp, "node_modules", "@scope", "x-plugin");
      mkdirSync(path.join(src, "node_modules", "dep"), { recursive: true });
      mkdirSync(path.join(src, "src"), { recursive: true });
      writeFileSync(path.join(src, "package.json"), JSON.stringify({ name: "@scope/x-plugin" }));
      writeFileSync(path.join(src, "src", "index.ts"), "");
      const dest = path.join(tmp, "out");
      expect(materializeBundledPlugins({ ids: ["x-plugin"], resolveSource: () => src, destDir: dest })).toEqual(["x-plugin"]);
      expect(readdirSync(path.join(dest, "x-plugin")).sort()).toEqual(["package.json", "src"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("readBundledPluginIds rejects a missing or malformed field", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "e22-bad-"));
    try {
      const pkg = path.join(tmp, "package.json");
      writeFileSync(pkg, JSON.stringify({ name: "x" }));
      expect(() => readBundledPluginIds(pkg)).toThrow(/bundledPlugins/);
      writeFileSync(pkg, JSON.stringify({ piDashboard: { bundledPlugins: ["ok", 3] } }));
      expect(() => readBundledPluginIds(pkg)).toThrow(/bundledPlugins/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});


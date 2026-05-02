/**
 * Pin the NSIS naming overrides in `packages/electron/forge.config.ts`.
 *
 * electron-builder's NSIS install-dir name fallback chain reads npm `name`
 * with slashes stripped — without the explicit `getAppBuilderConfig`
 * overrides, the install dir was `@blackbelt-technologypi-dashboard-electron`
 * (the original Windows defect). This test asserts every install-layer
 * name is pinned to `pi-dashboard` so a future contributor cannot
 * accidentally regress to electron-builder defaults.
 *
 * See change: fix-electron-windows-installer-and-server-bootstrap (D1, D2).
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FORGE_CONFIG_PATH = path.resolve(__dirname, "..", "..", "forge.config.ts");

describe("forge.config.ts NSIS naming overrides", () => {
  it("loads forge.config.ts and finds the NSIS maker", async () => {
    const mod = await import(url.pathToFileURL(FORGE_CONFIG_PATH).href);
    const config = mod.default;
    expect(config).toBeDefined();
    expect(Array.isArray(config.makers)).toBe(true);

    const nsisMaker = config.makers.find((m: { name: string }) =>
      m.name.includes("electron-forge-maker-nsis"),
    );
    expect(nsisMaker).toBeDefined();
    expect(typeof nsisMaker.config.getAppBuilderConfig).toBe("function");
  });

  it("getAppBuilderConfig returns the documented overrides", async () => {
    const mod = await import(url.pathToFileURL(FORGE_CONFIG_PATH).href);
    const config = mod.default;
    const nsisMaker = config.makers.find((m: { name: string }) =>
      m.name.includes("electron-forge-maker-nsis"),
    );
    const resolved = await nsisMaker.config.getAppBuilderConfig();

    // Naming pins (the entire D1+D2 contract).
    expect(resolved.productName).toBe("pi-dashboard");
    expect(resolved.appId).toBe("com.blackbelt-technology.pi-dashboard");
    expect(resolved.nsis).toBeDefined();
    expect(resolved.nsis.artifactName).toBe("pi-dashboard-Setup-${version}.exe");
    expect(resolved.nsis.shortcutName).toBe("pi-dashboard");
    expect(resolved.nsis.uninstallDisplayName).toBe("pi-dashboard");

    // Existing pre-fix `publish: null` injection is preserved.
    expect(resolved.publish).toBe(null);
  });

  it("rejects any -electron suffix in user-visible names", async () => {
    const mod = await import(url.pathToFileURL(FORGE_CONFIG_PATH).href);
    const nsisMaker = mod.default.makers.find((m: { name: string }) =>
      m.name.includes("electron-forge-maker-nsis"),
    );
    const resolved = await nsisMaker.config.getAppBuilderConfig();

    const visibleNames = [
      resolved.productName,
      resolved.appId,
      resolved.nsis.artifactName,
      resolved.nsis.shortcutName,
      resolved.nsis.uninstallDisplayName,
    ];
    for (const name of visibleNames) {
      expect(name).not.toContain("-electron");
      expect(name).not.toContain("@blackbelt-technology");
    }
  });
});

describe("packages/electron/package.json productName", () => {
  it("is the literal string 'pi-dashboard'", async () => {
    const pkgPath = path.resolve(__dirname, "..", "..", "package.json");
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw);
    expect(pkg.productName).toBe("pi-dashboard");
  });
});

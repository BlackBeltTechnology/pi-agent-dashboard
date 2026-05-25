/**
 * Tests for the shared bridge-register module.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// We test against a real temp filesystem
import { findBundledExtension, registerBridgeExtension } from "../bridge-register.js";

describe("shared bridge-register", () => {
  let tmpDir: string;
  let settingsPath: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-bridge-test-"));
    settingsPath = path.join(tmpDir, ".pi", "agent", "settings.json");
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSettings(data: Record<string, unknown>) {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
  }

  function readSettings(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  }

  describe("findBundledExtension", () => {
    it("finds extension in packages/extension/ under base dir", () => {
      const baseDir = path.join(tmpDir, "server");
      const extDir = path.join(baseDir, "packages", "extension");
      fs.mkdirSync(extDir, { recursive: true });
      fs.writeFileSync(path.join(extDir, "package.json"), '{"name":"test"}');

      expect(findBundledExtension(baseDir)).toBe(extDir);
    });

    it("returns null when extension dir does not exist", () => {
      // Disable Strategy 2 (node-resolver fallback) so we test Strategy 1 in isolation.
      expect(findBundledExtension(tmpDir, { resolvePackage: () => null })).toBeNull();
    });

    it("returns null when no package.json in extension dir", () => {
      const extDir = path.join(tmpDir, "packages", "extension");
      fs.mkdirSync(extDir, { recursive: true });
      // No package.json
      expect(findBundledExtension(tmpDir, { resolvePackage: () => null })).toBeNull();
    });

    it("returns null for AppImage temp mount paths", () => {
      const mockBase = "/tmp/.mount_PI1234/resources/server";
      // Even with a resolvable node-modules extension, if that resolved path is
      // itself under /tmp/.mount_* it must be rejected (tested separately below).
      expect(findBundledExtension(mockBase, { resolvePackage: () => null })).toBeNull();
    });

    it("Strategy 2 — falls back to require.resolve when baseDir has no packages/extension", () => {
      // Simulate `npm i -g pi-dashboard` layout: baseDir is the server
      // package root and contains no `packages/extension/`, but the
      // extension is resolvable as a runtime dep via node_modules.
      const fakeExtDir = path.join(tmpDir, "fake-node_modules", "pi-dashboard-extension");
      fs.mkdirSync(fakeExtDir, { recursive: true });
      fs.writeFileSync(path.join(fakeExtDir, "package.json"), '{"name":"fake"}');
      const resolved = findBundledExtension(tmpDir, {
        resolvePackage: () => path.join(fakeExtDir, "package.json"),
      });
      expect(resolved).toBe(fakeExtDir);
    });

    it("Strategy 2 — rejects AppImage-mount paths even when resolvable", () => {
      // A /tmp/.mount_* path must be rejected regardless of which strategy
      // surfaced it.
      const appImageExtDir = "/tmp/.mount_PI1234/node_modules/@blackbelt-technology/pi-dashboard-extension";
      const resolved = findBundledExtension(tmpDir, {
        resolvePackage: () => path.join(appImageExtDir, "package.json"),
      });
      expect(resolved).toBeNull();
    });
  });

  describe("registerBridgeExtension", () => {
    it("registers extension path in empty settings", () => {
      const extPath = "/app/packages/extension";
      registerBridgeExtension(extPath);

      const settings = readSettings();
      expect(settings.packages).toContain(extPath);
    });

    it("is idempotent — does not add duplicates", () => {
      const extPath = "/app/packages/extension";
      registerBridgeExtension(extPath);
      registerBridgeExtension(extPath);

      const settings = readSettings();
      const count = (settings.packages as string[]).filter(p => p === extPath).length;
      expect(count).toBe(1);
    });

    it("preserves existing valid dashboard paths", () => {
      // Create a valid extension dir
      const existingExt = path.join(tmpDir, "dev", "pi-agent-dashboard", "ext");
      fs.mkdirSync(existingExt, { recursive: true });
      fs.writeFileSync(path.join(existingExt, "package.json"), "{}");

      writeSettings({ packages: [existingExt] });

      const newPath = "/app/new/extension";
      registerBridgeExtension(newPath);

      const settings = readSettings();
      const packages = settings.packages as string[];
      expect(packages).toContain(existingExt); // preserved
      expect(packages).toContain(newPath); // added
    });

    it("removes stale (non-existent) dashboard paths", () => {
      const stalePath = "/old/nonexistent/pi-dashboard/ext";
      writeSettings({ packages: [stalePath] });

      const newPath = "/app/new/extension";
      registerBridgeExtension(newPath);

      const settings = readSettings();
      const packages = settings.packages as string[];
      expect(packages).not.toContain(stalePath);
      expect(packages).toContain(newPath);
    });

    it("removes stale app bundle paths with spaces or mixed case (macOS PI Dashboard.app)", () => {
      const stalePath = "/Applications/PI Dashboard.app/Contents/Resources/server/packages/extension";
      writeSettings({ packages: [stalePath] });

      const newPath = "/Applications/PI-Dashboard.app/Contents/Resources/server/packages/extension";
      registerBridgeExtension(newPath);

      const settings = readSettings();
      const packages = settings.packages as string[];
      expect(packages).not.toContain(stalePath);
      expect(packages).toContain(newPath);
    });

    it("removes stale Windows-style dashboard paths with mixed case", () => {
      const stalePath = "C:\\Program Files\\PI Dashboard\\resources\\server\\packages\\extension";
      writeSettings({ packages: [stalePath] });

      const newPath = "C:\\Program Files\\PI-Dashboard\\resources\\server\\packages\\extension";
      registerBridgeExtension(newPath);

      const settings = readSettings();
      const packages = settings.packages as string[];
      expect(packages).not.toContain(stalePath);
      expect(packages).toContain(newPath);
    });

    it("preserves non-dashboard paths", () => {
      writeSettings({ packages: ["/some/other/extension"] });

      registerBridgeExtension("/app/extension");

      const settings = readSettings();
      const packages = settings.packages as string[];
      expect(packages).toContain("/some/other/extension");
      expect(packages).toContain("/app/extension");
    });

    it("handles missing settings.json gracefully", () => {
      // No settings dir exists
      registerBridgeExtension("/app/extension");

      const settings = readSettings();
      expect(settings.packages).toContain("/app/extension");
    });

    it("identity-dedups across install layouts (same package.json#name wins last)", () => {
      // Three install layouts, all registering the same extension package
      // name under different absolute paths: dev workspace, .app bundle,
      // npm-global. After all three register, only the most recent path
      // should remain.
      const devPath = path.join(tmpDir, "dev", "ext");
      const appPath = path.join(tmpDir, "app", "ext");
      const globalPath = path.join(tmpDir, "global", "ext");
      for (const p of [devPath, appPath, globalPath]) {
        fs.mkdirSync(p, { recursive: true });
        fs.writeFileSync(
          path.join(p, "package.json"),
          '{"name":"@blackbelt-technology/pi-dashboard-extension"}',
        );
      }

      registerBridgeExtension(devPath);
      registerBridgeExtension(appPath);
      registerBridgeExtension(globalPath);

      const settings = readSettings();
      const packages = settings.packages as string[];
      expect(packages).toEqual([globalPath]);
    });

    it("preserves entries with different package names", () => {
      const otherExt = path.join(tmpDir, "other", "ext");
      fs.mkdirSync(otherExt, { recursive: true });
      fs.writeFileSync(
        path.join(otherExt, "package.json"),
        '{"name":"some-unrelated-extension"}',
      );

      const dashExt = path.join(tmpDir, "dash", "ext");
      fs.mkdirSync(dashExt, { recursive: true });
      fs.writeFileSync(
        path.join(dashExt, "package.json"),
        '{"name":"@blackbelt-technology/pi-dashboard-extension"}',
      );

      writeSettings({ packages: [otherExt] });
      registerBridgeExtension(dashExt);

      const settings = readSettings();
      const packages = settings.packages as string[];
      expect(packages).toContain(otherExt);
      expect(packages).toContain(dashExt);
    });

    it("leaves npm:-scheme entries untouched during identity dedup", () => {
      const npmEntry = "npm:@blackbelt-technology/pi-dashboard-extension";
      const localExt = path.join(tmpDir, "local", "ext");
      fs.mkdirSync(localExt, { recursive: true });
      fs.writeFileSync(
        path.join(localExt, "package.json"),
        '{"name":"@blackbelt-technology/pi-dashboard-extension"}',
      );

      writeSettings({ packages: [npmEntry] });
      registerBridgeExtension(localExt);

      const settings = readSettings();
      const packages = settings.packages as string[];
      expect(packages).toContain(npmEntry);
      expect(packages).toContain(localExt);
    });
  });
});

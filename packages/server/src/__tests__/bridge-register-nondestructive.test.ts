/**
 * Tests for non-destructive bridge registration cleanup.
 * Verifies that existing valid extension paths are preserved,
 * while stale (non-existent) paths are removed.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerBridgeExtension } from "@blackbelt-technology/pi-dashboard-shared/bridge-register.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("non-destructive bridge registration", () => {
  let tmpDir: string;
  let settingsPath: string;
  let origHome: string | undefined;
  let fakeExtensionDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-reg-test-"));
    settingsPath = path.join(tmpDir, ".pi", "agent", "settings.json");
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;

    // Create a fake "existing valid" extension dir that looks like a dev install
    fakeExtensionDir = path.join(tmpDir, "dev-project", "pi-agent-dashboard", "packages", "extension");
    fs.mkdirSync(fakeExtensionDir, { recursive: true });
    fs.writeFileSync(path.join(fakeExtensionDir, "package.json"), '{"name":"test"}');
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

  it("preserves existing valid dashboard extension path", () => {
    writeSettings({ packages: [fakeExtensionDir] });

    const newPath = path.join(tmpDir, "new-extension");
    registerBridgeExtension(newPath);

    const settings = readSettings();
    const packages = settings.packages as string[];
    expect(packages).toContain(fakeExtensionDir);
    expect(packages).toContain(newPath);
  });

  it("removes stale (non-existent) dashboard extension path", () => {
    const stalePath = "/old/nonexistent/pi-dashboard/extension";
    writeSettings({ packages: [stalePath, fakeExtensionDir] });

    const newPath = path.join(tmpDir, "new-extension");
    registerBridgeExtension(newPath);

    const settings = readSettings();
    const packages = settings.packages as string[];
    expect(packages).not.toContain(stalePath);
    expect(packages).toContain(fakeExtensionDir);
    expect(packages).toContain(newPath);
  });

  it("does not add duplicate entries", () => {
    writeSettings({ packages: [fakeExtensionDir] });

    registerBridgeExtension(fakeExtensionDir);

    const settings = readSettings();
    const packages = settings.packages as string[];
    const count = packages.filter(p => p === fakeExtensionDir).length;
    expect(count).toBe(1);
  });

  it("preserves non-dashboard extension paths", () => {
    const otherExt = "/some/other/extension";
    writeSettings({ packages: [otherExt, fakeExtensionDir] });

    const newPath = path.join(tmpDir, "new-extension");
    registerBridgeExtension(newPath);

    const settings = readSettings();
    const packages = settings.packages as string[];
    expect(packages).toContain(otherExt);
  });

  it("removes path without package.json even if directory exists", () => {
    const noPkgDir = path.join(tmpDir, "broken-pi-dashboard");
    fs.mkdirSync(noPkgDir, { recursive: true });

    writeSettings({ packages: [noPkgDir, fakeExtensionDir] });

    const newPath = path.join(tmpDir, "new-extension");
    registerBridgeExtension(newPath);

    const settings = readSettings();
    const packages = settings.packages as string[];
    expect(packages).not.toContain(noPkgDir);
    expect(packages).toContain(fakeExtensionDir);
  });
});

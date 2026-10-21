/**
 * Tests for the shared bridge extension registration (server context).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findBundledExtension, registerBridgeExtension } from "@blackbelt-technology/pi-dashboard-shared/bridge-register.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("bridge extension registration (server context)", () => {
  let tmpDir: string;
  let settingsPath: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ext-reg-test-"));
    settingsPath = path.join(tmpDir, ".pi", "agent", "settings.json");
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("findBundledExtension returns null when extension dir does not exist", () => {
    // Strategy 2 (require.resolve) would find the monorepo extension;
    // disable it for this test so we exercise Strategy 1 in isolation.
    const result = findBundledExtension(tmpDir, { resolvePackage: () => null });
    expect(result).toBeNull();
  });

  it("findBundledExtension finds extension under base dir", () => {
    const extDir = path.join(tmpDir, "packages", "extension");
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(path.join(extDir, "package.json"), "{}");
    expect(findBundledExtension(tmpDir)).toBe(extDir);
  });

  it("registerBridgeExtension adds extension to empty settings file", () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, "{}");

    registerBridgeExtension("/test/extension");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(settings.packages).toContain("/test/extension");
  });

  it("should not crash on malformed settings.json", () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, "not valid json{{{");
    // Should not throw — starts fresh
    registerBridgeExtension("/test/extension");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(settings.packages).toContain("/test/extension");
  });

  it("should not crash when settings directory does not exist", () => {
    // HOME points to tmpDir but .pi/agent/ doesn't exist
    registerBridgeExtension("/test/extension");
    // Should create the directory and write
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(settings.packages).toContain("/test/extension");
  });
});

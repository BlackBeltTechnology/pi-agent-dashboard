/**
 * Editor config round-trip (task 7.6b).
 *
 * Asserts that `EditorConfig.stopOnDashboardExit` round-trips through
 * `loadConfig` (default-applies + parses) and that an explicit `true`
 * value is preserved.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, DEFAULT_EDITOR_CONFIG } from "../config.js";

describe("EditorConfig.stopOnDashboardExit round-trip (task 7.6b)", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-cfg-editor-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("defaults to false when missing", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
    const cfg = loadConfig();
    expect(cfg.editor.stopOnDashboardExit).toBe(false);
    expect(DEFAULT_EDITOR_CONFIG.stopOnDashboardExit).toBe(false);
  });

  it("preserves explicit true", () => {
    fs.writeFileSync(configFile, JSON.stringify({ editor: { stopOnDashboardExit: true } }));
    const cfg = loadConfig();
    expect(cfg.editor.stopOnDashboardExit).toBe(true);
  });

  it("preserves explicit false", () => {
    fs.writeFileSync(configFile, JSON.stringify({ editor: { stopOnDashboardExit: false } }));
    const cfg = loadConfig();
    expect(cfg.editor.stopOnDashboardExit).toBe(false);
  });

  it("ignores non-boolean values and falls back to default", () => {
    fs.writeFileSync(configFile, JSON.stringify({ editor: { stopOnDashboardExit: "yes" } }));
    const cfg = loadConfig();
    expect(cfg.editor.stopOnDashboardExit).toBe(false);
  });
});

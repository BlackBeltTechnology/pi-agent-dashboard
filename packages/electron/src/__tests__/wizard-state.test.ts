import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addRecentRemote,
  isApiKeyConfigured,
  isFirstRun,
  listRecentRemotes,
  readModeFile,
  removeRecentRemote,
  writeApiKey,
  writeModeFile,
} from "../lib/wizard-state.js";

describe("wizard-state", () => {
  let testDir: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-wizard-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(path.join(testDir, ".pi-dashboard"), { recursive: true });
    fs.mkdirSync(path.join(testDir, ".pi", "agent"), { recursive: true });
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("isFirstRun returns true when mode.json does not exist", () => {
    expect(isFirstRun()).toBe(true);
  });

  it("isFirstRun returns false after writeModeFile", () => {
    writeModeFile("standalone");
    expect(isFirstRun()).toBe(false);
  });

  it("writeModeFile persists mode and timestamp", () => {
    writeModeFile("power-user");
    const config = readModeFile();
    expect(config?.mode).toBe("power-user");
    expect(config?.completedAt).toBeDefined();
  });

  it("readModeFile returns null for missing file", () => {
    expect(readModeFile()).toBeNull();
  });

  it("isApiKeyConfigured returns false when no settings", () => {
    expect(isApiKeyConfigured()).toBe(false);
  });

  it("isApiKeyConfigured returns true after writeApiKey", () => {
    writeApiKey("anthropic", "sk-test-123");
    expect(isApiKeyConfigured()).toBe(true);
  });

  // See change: fix-doctor-oauth-credential-detection.
  it("isApiKeyConfigured returns true for OAuth-only auth.json", () => {
    const authFile = path.join(testDir, ".pi", "agent", "auth.json");
    fs.writeFileSync(
      authFile,
      JSON.stringify({
        anthropic: { type: "oauth", access: "tok", refresh: "r", expires: 9e15 },
      }),
    );
    expect(isApiKeyConfigured()).toBe(true);
  });

  it("writeApiKey creates settings file if missing", () => {
    const settingsFile = path.join(testDir, ".pi", "agent", "settings.json");
    expect(fs.existsSync(settingsFile)).toBe(false);
    writeApiKey("openai", "sk-openai-123");
    expect(fs.existsSync(settingsFile)).toBe(true);
    const data = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
    expect(data.openaiApiKey).toBe("sk-openai-123");
  });

  // ── mode.json → dashboard-settings.json migration (2B.4) ────────────
  describe("legacy mode.json migration", () => {
    const settingsFile = () => path.join(testDir, ".pi-dashboard", "dashboard-settings.json");
    const legacyFile = () => path.join(testDir, ".pi-dashboard", "mode.json");

    it("readModeFile migrates a legacy mode.json to dashboard-settings.json", () => {
      fs.writeFileSync(legacyFile(), JSON.stringify({ mode: "remote", completedAt: "x", remoteUrl: "http://h:8000" }));
      expect(fs.existsSync(settingsFile())).toBe(false);
      expect(readModeFile()).toMatchObject({ mode: "remote", remoteUrl: "http://h:8000" });
      // New file written, legacy deleted.
      expect(fs.existsSync(settingsFile())).toBe(true);
      expect(fs.existsSync(legacyFile())).toBe(false);
    });

    it("isFirstRun is false when only a legacy mode.json exists", () => {
      fs.writeFileSync(legacyFile(), JSON.stringify({ mode: "standalone", completedAt: "x" }));
      expect(isFirstRun()).toBe(false);
    });
  });

  // ── Recent remote servers (2B.5) ───────────────────────────────────
  describe("recent remotes", () => {
    it("listRecentRemotes is empty by default", () => {
      expect(listRecentRemotes()).toEqual([]);
    });

    it("addRecentRemote prepends MRU and dedupes", () => {
      addRecentRemote("http://a:8000");
      addRecentRemote("http://b:8000");
      addRecentRemote("http://a:8000"); // re-add moves to front
      expect(listRecentRemotes().map((r) => r.url)).toEqual(["http://a:8000", "http://b:8000"]);
    });

    it("caps the list at 8 entries", () => {
      for (let i = 0; i < 12; i++) addRecentRemote(`http://h${i}:8000`);
      const urls = listRecentRemotes().map((r) => r.url);
      expect(urls).toHaveLength(8);
      expect(urls[0]).toBe("http://h11:8000"); // most recent first
    });

    it("removeRecentRemote prunes an entry", () => {
      addRecentRemote("http://a:8000");
      addRecentRemote("http://b:8000");
      removeRecentRemote("http://a:8000");
      expect(listRecentRemotes().map((r) => r.url)).toEqual(["http://b:8000"]);
    });

    it("writeModeFile preserves recentRemotes", () => {
      addRecentRemote("http://a:8000");
      writeModeFile("standalone");
      expect(listRecentRemotes().map((r) => r.url)).toEqual(["http://a:8000"]);
    });
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addDismissedVersionSkew,
  addRecentRemote,
  isApiKeyConfigured,
  isFirstRun,
  listRecentRemotes,
  readDismissedVersionSkews,
  readModeFile,
  removeRecentRemote,
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

  // Detection still reads the legacy settings.json field; nothing here writes it.
  it("isApiKeyConfigured returns true for a legacy settings.json API key", () => {
    fs.writeFileSync(path.join(testDir, ".pi", "agent", "settings.json"), JSON.stringify({ anthropicApiKey: "sk-test-123" }));
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

  // See change: pi-settings-full-coverage (test-plan #E22): provider keys are stored
  // through Settings → Providers (auth.json); no Electron code writes settings.json credentials.
  it("no Electron source writes a provider API key into pi's settings.json", () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === "__tests__" || e.name === "node_modules" ? [] : walk(p);
        return /\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
      });
    const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    // Built from parts so this file itself never matches a grep for the removed writer.
    const writer = ["write", "ApiKey"].join("");
    const offenders = walk(srcRoot).filter((f) => new RegExp(`${writer}|\\.(anthropicApiKey|openaiApiKey)\\s*=(?!=)|\\.apiKey\\s*=(?!=)`).test(fs.readFileSync(f, "utf-8")));
    expect(offenders).toEqual([]);
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

  describe("version-skew dismissals (E19, E20)", () => {
    const file = () => path.join(testDir, ".pi-dashboard", "version-skew-dismissals.json");
    const pair = (n: number) => ({ server: `0.${n}.0`, expected: "1.0.0", launchSource: "standalone" });

    it("E19: absent or corrupt file → []", () => {
      expect(readDismissedVersionSkews()).toEqual([]);
      fs.writeFileSync(file(), "{not json");
      expect(readDismissedVersionSkews()).toEqual([]);
    });

    it("E19: 19 and 20 pairs kept; the 21st evicts the oldest", () => {
      for (let i = 0; i < 19; i++) addDismissedVersionSkew(pair(i));
      expect(readDismissedVersionSkews()).toHaveLength(19);
      addDismissedVersionSkew(pair(19));
      expect(readDismissedVersionSkews()).toHaveLength(20);
      addDismissedVersionSkew(pair(20));
      const all = readDismissedVersionSkews();
      expect(all).toHaveLength(20);
      expect(all[0].server).toBe("0.1.0");
      expect(all[19].server).toBe("0.20.0");
    });

    it("E19: a duplicate is not re-added; no tmp file left (tmp + rename)", () => {
      addDismissedVersionSkew(pair(1));
      addDismissedVersionSkew(pair(1));
      expect(readDismissedVersionSkews()).toHaveLength(1);
      expect(fs.readdirSync(path.join(testDir, ".pi-dashboard")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    });

    it("E20: dismissal does not create settings or end first-run", () => {
      addDismissedVersionSkew(pair(1));
      expect(fs.existsSync(path.join(testDir, ".pi-dashboard", "dashboard-settings.json"))).toBe(false);
      expect(isFirstRun()).toBe(true);
    });
  });
});

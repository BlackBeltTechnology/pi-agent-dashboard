import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { metaPath } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { needsMigration, runMigration, type MigrationPaths } from "../persistence/migrate-persistence.js";

describe("migrate-persistence", () => {
  let tmpDir: string;
  let configDir: string;
  let sessionsDir: string;

  function paths(): MigrationPaths {
    return {
      sessionsFile: path.join(configDir, "sessions.json"),
      stateFile: path.join(configDir, "state.json"),
      preferencesFile: path.join(configDir, "preferences.json"),
      sessionsDir,
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-test-"));
    configDir = path.join(tmpDir, "config");
    sessionsDir = path.join(tmpDir, "sessions");
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(sessionsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createSessionFile(cwdEncoded: string, filename: string): string {
    const dir = path.join(sessionsDir, cwdEncoded);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, JSON.stringify({ type: "session", id: "test" }) + "\n");
    return filePath;
  }

  function writeConfig(name: string, data: unknown): void {
    fs.writeFileSync(path.join(configDir, name), JSON.stringify(data, null, 2));
  }

  it("should detect migration needed when sessions.json exists", () => {
    writeConfig("sessions.json", []);
    expect(needsMigration(paths())).toBe(true);
  });

  it("should detect migration needed when state.json exists", () => {
    writeConfig("state.json", {});
    expect(needsMigration(paths())).toBe(true);
  });

  it("should not need migration when no old files exist", () => {
    expect(needsMigration(paths())).toBe(false);
  });

  it("should migrate sessions.json to .meta.json files", () => {
    const sf = createSessionFile("--test--", "2026-01-01T00-00-00-000Z_abc-123.jsonl");
    writeConfig("sessions.json", [{
      id: "abc-123",
      sessionFile: sf,
      cwd: "/test",
      name: "My Session",
      source: "dashboard",
      cost: 5.0,
      tokensIn: 100,
    }]);
    writeConfig("state.json", { hiddenSessions: [], pinnedDirectories: [], sessionOrder: {} });

    const result = runMigration(paths());

    expect(result.sessionsWritten).toBe(1);
    const meta = readSessionMeta(sf);
    expect(meta?.cwd).toBe("/test");
    expect(meta?.name).toBe("My Session");
    expect(meta?.cost).toBe(5.0);
    expect(meta?.cachedAt).toBeGreaterThan(0);
  });

  it("should apply hidden IDs from state.json to .meta.json", () => {
    const sf = createSessionFile("--test--", "2026-01-01T00-00-00-000Z_hidden-id.jsonl");
    writeConfig("sessions.json", [{ id: "hidden-id", sessionFile: sf, cwd: "/test" }]);
    writeConfig("state.json", { hiddenSessions: ["hidden-id"], pinnedDirectories: [], sessionOrder: {} });

    const result = runMigration(paths());

    expect(result.hiddenApplied).toBe(1);
    const meta = readSessionMeta(sf);
    expect(meta?.hidden).toBe(true);
  });

  it("should find hidden IDs by UUID scan when not in sessions.json", () => {
    createSessionFile("--test--", "2026-01-01T00-00-00-000Z_scan-uuid.jsonl");
    writeConfig("sessions.json", []);
    writeConfig("state.json", { hiddenSessions: ["scan-uuid"], pinnedDirectories: [], sessionOrder: {} });

    const result = runMigration(paths());

    expect(result.hiddenApplied).toBe(1);
  });

  it("should skip orphaned hidden IDs with no matching file", () => {
    writeConfig("sessions.json", []);
    writeConfig("state.json", { hiddenSessions: ["ghost-id"], pinnedDirectories: [], sessionOrder: {} });

    const result = runMigration(paths());

    expect(result.hiddenOrphaned).toBe(1);
    expect(result.hiddenApplied).toBe(0);
  });

  it("should write preferences.json from state.json", () => {
    writeConfig("state.json", {
      hiddenSessions: [],
      pinnedDirectories: ["/a", "/b"],
      sessionOrder: { "/a": ["s1"] },
    });

    runMigration(paths());

    const prefs = JSON.parse(fs.readFileSync(path.join(configDir, "preferences.json"), "utf-8"));
    expect(prefs.pinnedDirectories).toEqual(["/a", "/b"]);
    expect(prefs.sessionOrder).toEqual({ "/a": ["s1"] });
    expect(prefs.hiddenSessions).toBeUndefined();
  });

  it("should rename old files to .bak", () => {
    writeConfig("sessions.json", []);
    writeConfig("state.json", {});

    const result = runMigration(paths());

    expect(fs.existsSync(path.join(configDir, "sessions.json"))).toBe(false);
    expect(fs.existsSync(path.join(configDir, "state.json"))).toBe(false);
    expect(fs.existsSync(path.join(configDir, "sessions.json.bak"))).toBe(true);
    expect(fs.existsSync(path.join(configDir, "state.json.bak"))).toBe(true);
    expect(result.oldFilesRenamed).toEqual(["sessions.json", "state.json"]);
  });

  it("should be idempotent — merge with existing .meta.json", () => {
    const sf = createSessionFile("--test--", "2026-01-01T00-00-00-000Z_merge-id.jsonl");
    // Pre-existing .meta.json with source
    const mp = metaPath(sf);
    fs.writeFileSync(mp, JSON.stringify({ source: "dashboard", name: "Existing" }));

    writeConfig("sessions.json", [{ id: "merge-id", sessionFile: sf, cwd: "/test", cost: 3.0 }]);
    writeConfig("state.json", {});

    runMigration(paths());

    const meta = readSessionMeta(sf);
    expect(meta?.cost).toBe(3.0);
    expect(meta?.cwd).toBe("/test");
    expect(meta?.source).toBe("dashboard");
  });

  it("should handle only sessions.json (no state.json)", () => {
    const sf = createSessionFile("--test--", "2026-01-01T00-00-00-000Z_only-sess.jsonl");
    writeConfig("sessions.json", [{ id: "only-sess", sessionFile: sf, cwd: "/test" }]);

    const result = runMigration(paths());

    expect(result.sessionsWritten).toBe(1);
    expect(result.preferencesWritten).toBe(true);
    expect(result.oldFilesRenamed).toEqual(["sessions.json"]);
  });

  it("should skip sessions with missing sessionFile", () => {
    writeConfig("sessions.json", [{ id: "no-file", cwd: "/test" }]);
    writeConfig("state.json", {});

    const result = runMigration(paths());

    expect(result.sessionsWritten).toBe(0);
  });
});

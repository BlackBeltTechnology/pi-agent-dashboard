import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectSessionSource } from "../source-detector.js";
import { writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";

describe("detectSessionSource", () => {
  const originalEnv = { ...process.env };
  let tmpDir: string;

  beforeEach(() => {
    delete process.env.ZED_TERM;
    delete process.env.TMUX;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "source-detect-test-"));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return 'dashboard' when .meta.json has source dashboard", () => {
    const sessionFile = path.join(tmpDir, "test.jsonl");
    writeSessionMeta(sessionFile, { source: "dashboard" });
    expect(detectSessionSource(undefined, sessionFile)).toBe("dashboard");
  });

  it("should return 'tui' (not 'dashboard') when a TUI is attached, even if .meta.json says dashboard", () => {
    // Defends against event-wiring's pendingDashboardSpawns by-cwd matcher
    // mis-tagging a CLI pi launched in the same cwd as a dashboard Spawn.
    const sessionFile = path.join(tmpDir, "test.jsonl");
    writeSessionMeta(sessionFile, { source: "dashboard" });
    expect(detectSessionSource(true, sessionFile)).toBe("tui");
  });

  it("should return 'tmux' when TUI is attached inside tmux, even if .meta.json says dashboard", () => {
    process.env.TMUX = "/tmp/tmux/default";
    const sessionFile = path.join(tmpDir, "test.jsonl");
    writeSessionMeta(sessionFile, { source: "dashboard" });
    expect(detectSessionSource(true, sessionFile)).toBe("tmux");
  });

  it("should return 'zed' when ZED_TERM is set and hasUI is false", () => {
    process.env.ZED_TERM = "1";
    expect(detectSessionSource(false)).toBe("zed");
  });

  it("should return 'zed' when ZED_TERM is set and hasUI is not provided", () => {
    process.env.ZED_TERM = "1";
    expect(detectSessionSource()).toBe("zed");
  });

  it("should return 'tui' when ZED_TERM is set but hasUI is true", () => {
    process.env.ZED_TERM = "1";
    expect(detectSessionSource(true)).toBe("tui");
  });

  it("should return 'tmux' when TMUX is set", () => {
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";
    expect(detectSessionSource()).toBe("tmux");
  });

  it("should return 'tui' when no env vars or meta file", () => {
    expect(detectSessionSource()).toBe("tui");
  });

  it("should return 'tui' when no session file provided", () => {
    expect(detectSessionSource(undefined, undefined)).toBe("tui");
  });

  it("should prioritize zed over tmux when hasUI is false", () => {
    process.env.ZED_TERM = "1";
    process.env.TMUX = "something";
    expect(detectSessionSource(false)).toBe("zed");
  });

  it("should return 'tui' over tmux when ZED_TERM is set and hasUI is true", () => {
    process.env.ZED_TERM = "1";
    process.env.TMUX = "something";
    expect(detectSessionSource(true)).toBe("tui");
  });

  it("should return 'tui' when meta file does not exist", () => {
    const sessionFile = path.join(tmpDir, "nonexistent.jsonl");
    expect(detectSessionSource(undefined, sessionFile)).toBe("tui");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { metaPath, readSessionMeta, writeSessionMeta, mergeSessionMeta } from "../session-meta.js";

describe("session-meta", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-meta-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("metaPath", () => {
    it("should derive .meta.json from .jsonl path", () => {
      const sessionFile = "/home/user/.pi/sessions/cwd/2026-01-01T00-00-00-000Z_abc123.jsonl";
      expect(metaPath(sessionFile)).toBe(
        "/home/user/.pi/sessions/cwd/2026-01-01T00-00-00-000Z_abc123.meta.json"
      );
    });
  });

  describe("writeSessionMeta / readSessionMeta", () => {
    it("should write and read meta", () => {
      const sessionFile = path.join(tmpDir, "test-session.jsonl");
      writeSessionMeta(sessionFile, { source: "dashboard" });
      const meta = readSessionMeta(sessionFile);
      expect(meta).toEqual({ source: "dashboard" });
    });

    it("should return undefined for missing meta file", () => {
      const sessionFile = path.join(tmpDir, "nonexistent.jsonl");
      expect(readSessionMeta(sessionFile)).toBeUndefined();
    });

    it("should return undefined for invalid JSON", () => {
      const sessionFile = path.join(tmpDir, "bad.jsonl");
      fs.writeFileSync(path.join(tmpDir, "bad.meta.json"), "not json");
      expect(readSessionMeta(sessionFile)).toBeUndefined();
    });

    it("should write and read expanded fields", () => {
      const sessionFile = path.join(tmpDir, "expanded.jsonl");
      writeSessionMeta(sessionFile, {
        source: "dashboard",
        name: "General",
        attachedProposal: "my-change",
        hidden: false,
        cwd: "/Users/test/project",
        status: "ended",
        startedAt: 1000,
        endedAt: 2000,
        model: "anthropic/claude-sonnet-4-20250514",
        thinkingLevel: "medium",
        tokensIn: 100,
        tokensOut: 200,
        cacheRead: 300,
        cacheWrite: 400,
        cost: 1.5,
        contextTokens: 5000,
        contextWindow: 200000,
        firstMessage: "Hello",
        cachedAt: 3000,
      });
      const meta = readSessionMeta(sessionFile);
      expect(meta?.name).toBe("General");
      expect(meta?.cost).toBe(1.5);
      expect(meta?.cachedAt).toBe(3000);
      expect(meta?.hidden).toBe(false);
    });

    it("should read minimal meta (backward compat)", () => {
      const sessionFile = path.join(tmpDir, "minimal.jsonl");
      writeSessionMeta(sessionFile, { source: "dashboard" });
      const meta = readSessionMeta(sessionFile);
      expect(meta).toEqual({ source: "dashboard" });
      expect(meta?.name).toBeUndefined();
      expect(meta?.cost).toBeUndefined();
    });

    it("should use atomic write (tmp + rename)", () => {
      const sessionFile = path.join(tmpDir, "atomic.jsonl");
      writeSessionMeta(sessionFile, { source: "dashboard" });
      // tmp file should not remain
      const tmpFile = metaPath(sessionFile) + ".tmp";
      expect(fs.existsSync(tmpFile)).toBe(false);
      expect(fs.existsSync(metaPath(sessionFile))).toBe(true);
    });
  });

  describe("mergeSessionMeta", () => {
    it("should merge new fields into existing meta", () => {
      const sessionFile = path.join(tmpDir, "merge.jsonl");
      writeSessionMeta(sessionFile, { source: "dashboard", name: "Old" });
      mergeSessionMeta(sessionFile, { name: "New", cost: 5.0 });
      const meta = readSessionMeta(sessionFile);
      expect(meta?.source).toBe("dashboard");
      expect(meta?.name).toBe("New");
      expect(meta?.cost).toBe(5.0);
    });

    it("should create file if it does not exist", () => {
      const sessionFile = path.join(tmpDir, "new-merge.jsonl");
      mergeSessionMeta(sessionFile, { hidden: true, cost: 1.0 });
      const meta = readSessionMeta(sessionFile);
      expect(meta?.hidden).toBe(true);
      expect(meta?.cost).toBe(1.0);
    });

    it("should preserve isGitRepo tri-state through merge round-trip", () => {
      const sessionFile = path.join(tmpDir, "is-git-repo.jsonl");
      writeSessionMeta(sessionFile, { source: "dashboard", isGitRepo: false });
      expect(readSessionMeta(sessionFile)?.isGitRepo).toBe(false);
      mergeSessionMeta(sessionFile, { isGitRepo: true });
      expect(readSessionMeta(sessionFile)?.isGitRepo).toBe(true);
      // Merging an unrelated field preserves the existing isGitRepo.
      mergeSessionMeta(sessionFile, { name: "X" });
      expect(readSessionMeta(sessionFile)?.isGitRepo).toBe(true);
      // Absent field stays undefined.
      const other = path.join(tmpDir, "no-git-flag.jsonl");
      writeSessionMeta(other, { source: "dashboard" });
      expect(readSessionMeta(other)?.isGitRepo).toBeUndefined();
    });

    it("should preserve unknown fields", () => {
      const sessionFile = path.join(tmpDir, "unknown.jsonl");
      // Write a file with an unknown field
      const p = metaPath(sessionFile);
      fs.writeFileSync(p, JSON.stringify({ source: "dashboard", customField: 42 }) + "\n");
      mergeSessionMeta(sessionFile, { name: "Test" });
      const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
      expect(raw.customField).toBe(42);
      expect(raw.name).toBe("Test");
    });
  });
});

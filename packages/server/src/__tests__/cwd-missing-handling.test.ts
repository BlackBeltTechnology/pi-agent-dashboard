/**
 * Tests for server cwd-loss handling: event-wiring handler, scanner
 * probe, and spawn-preflight alias.
 *
 * See change: add-worktree-lifecycle-actions.
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { preflightSpawn } from "../spawn-process/spawn-preflight.js";
import { scanAllSessions } from "../session/session-scanner.js";
import { writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";

vi.mock("../session/session-stats-reader.js", () => ({
  extractSessionStats: vi.fn(() => null),
}));

describe("preflightSpawn — cwd_missing alias", () => {
  it("emits BOTH DIR_MISSING and cwd_missing reasons for a deleted cwd", () => {
    const result = preflightSpawn("/nonexistent/totally-gone");
    const codes = result.reasons.map((r) => r.code);
    expect(codes).toContain("DIR_MISSING");
    expect(codes).toContain("cwd_missing");
  });
});

describe("session-scanner — cwdMissing probe", () => {
  it("stamps cwdMissing: true for ended sessions whose cwd is gone", () => {
    const sessionsRoot = realpathSync(mkdtempSync(join(tmpdir(), "scanner-cwd-gone-")));
    try {
      const goneCwd = join(sessionsRoot, "actually-gone");
      // We never create `goneCwd` on disk — it's "missing".
      // The scanner expects sessions under <sessionsRoot>/<urlencoded-cwd>/<sessionFile>.jsonl
      // plus a .meta.json sidecar. Use a minimal valid layout.
      const cwdSlug = "test-cwd";
      const cwdSessionDir = join(sessionsRoot, cwdSlug);
      mkdirSync(cwdSessionDir, { recursive: true });
      const sessionFile = join(cwdSessionDir, "2024-01-01T12-00-00-000Z_abc.jsonl");
      writeFileSync(sessionFile, JSON.stringify({ type: "session", id: "abc", cwd: goneCwd, timestamp: "2024-01-01T12:00:00.000Z" }) + "\n");
      writeSessionMeta(sessionFile, {
        cwd: goneCwd,
        status: "ended",
        startedAt: Date.now(),
        cachedAt: Date.now(),
      } as any);
      const { sessions } = scanAllSessions(sessionsRoot);
      const target = sessions.find((s) => s.cwd === goneCwd);
      expect(target).toBeDefined();
      expect(target?.cwdMissing).toBe(true);
    } finally {
      rmSync(sessionsRoot, { recursive: true, force: true });
    }
  });

  it("stamps cwdMissing: false for sessions whose cwd exists", () => {
    const sessionsRoot = realpathSync(mkdtempSync(join(tmpdir(), "scanner-cwd-here-")));
    const realCwd = realpathSync(mkdtempSync(join(tmpdir(), "real-cwd-")));
    try {
      const cwdSessionDir = join(sessionsRoot, "x");
      mkdirSync(cwdSessionDir, { recursive: true });
      const sessionFile = join(cwdSessionDir, "2024-01-01T12-00-00-000Z_ok.jsonl");
      writeFileSync(sessionFile, JSON.stringify({ type: "session", id: "ok", cwd: realCwd, timestamp: "2024-01-01T12:00:00.000Z" }) + "\n");
      writeSessionMeta(sessionFile, {
        cwd: realCwd,
        status: "ended",
        startedAt: Date.now(),
        cachedAt: Date.now(),
      } as any);
      const { sessions } = scanAllSessions(sessionsRoot);
      const target = sessions.find((s) => s.cwd === realCwd);
      expect(target).toBeDefined();
      expect(target?.cwdMissing).toBe(false);
    } finally {
      rmSync(sessionsRoot, { recursive: true, force: true });
      rmSync(realCwd, { recursive: true, force: true });
    }
  });

  it("leaves cwdMissing undefined when cwd is empty string", () => {
    const sessionsRoot = realpathSync(mkdtempSync(join(tmpdir(), "scanner-no-cwd-")));
    try {
      const cwdSessionDir = join(sessionsRoot, "x");
      mkdirSync(cwdSessionDir, { recursive: true });
      const sessionFile = join(cwdSessionDir, "2024-01-01T12-00-00-000Z_z.jsonl");
      writeFileSync(sessionFile, JSON.stringify({ type: "session", id: "z", cwd: "", timestamp: "2024-01-01T12:00:00.000Z" }) + "\n");
      writeSessionMeta(sessionFile, {
        cwd: "",
        status: "ended",
        startedAt: Date.now(),
        cachedAt: Date.now(),
      } as any);
      const { sessions } = scanAllSessions(sessionsRoot);
      const target = sessions.find((s) => s.id === "z");
      expect(target).toBeDefined();
      expect(target?.cwdMissing).toBeUndefined();
    } finally {
      rmSync(sessionsRoot, { recursive: true, force: true });
    }
  });
});

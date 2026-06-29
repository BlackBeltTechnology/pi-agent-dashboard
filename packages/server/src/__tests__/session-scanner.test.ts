import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scanAllSessions } from "../session-scanner.js";
import { metaPath, writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";

// Mock extractSessionStats to avoid needing real JSONL content with usage data
vi.mock("../session-stats-reader.js", () => ({
  extractSessionStats: vi.fn(() => ({
    tokensIn: 10,
    tokensOut: 20,
    cacheRead: 30,
    cacheWrite: 40,
    cost: 0.5,
    lastTotalTokens: 1000,
    contextWindow: 200000,
    model: "anthropic/claude-sonnet-4-20250514",
    thinkingLevel: "medium",
  })),
}));

describe("session-scanner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createSessionDir(cwdEncoded: string): string {
    const dir = path.join(tmpDir, cwdEncoded);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function createJsonl(dir: string, filename: string, header?: { id: string; cwd: string }): string {
    const filePath = path.join(dir, filename);
    const h = header ?? { id: "test-id", cwd: "/test/cwd" };
    const lines = [
      JSON.stringify({ type: "session", id: h.id, cwd: h.cwd, timestamp: "2026-03-30T21:39:43.034Z" }),
      JSON.stringify({ type: "message", message: { role: "user", content: "Hello world" } }),
    ];
    fs.writeFileSync(filePath, lines.join("\n") + "\n");
    return filePath;
  }

  it("should return empty for non-existent directory", () => {
    const result = scanAllSessions("/non/existent/path");
    expect(result.sessions).toEqual([]);
    expect(result.cacheUpdates).toBe(0);
  });

  it("should return empty for empty sessions directory", () => {
    const result = scanAllSessions(tmpDir);
    expect(result.sessions).toEqual([]);
  });

  it("should discover session from .meta.json with cached data", () => {
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_abc-123.jsonl", { id: "abc-123", cwd: "/test/cwd" });
    writeSessionMeta(sf, {
      cwd: "/test/cwd",
      name: "My Session",
      source: "dashboard",
      status: "ended",
      startedAt: 1000,
      cost: 5.0,
      tokensIn: 100,
      tokensOut: 200,
      cachedAt: Date.now() + 10000, // far future = fresh cache
    });

    const result = scanAllSessions(tmpDir);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].id).toBe("abc-123");
    expect(result.sessions[0].cwd).toBe("/test/cwd");
    expect(result.sessions[0].name).toBe("My Session");
    expect(result.sessions[0].cost).toBe(5.0);
    expect(result.cacheUpdates).toBe(0); // no re-extraction needed
  });

  it("should fall back to .jsonl parsing when no .meta.json exists", () => {
    const dir = createSessionDir("--test-cwd--");
    createJsonl(dir, "2026-03-30T21-39-43-034Z_def-456.jsonl", { id: "def-456", cwd: "/fallback/cwd" });

    const result = scanAllSessions(tmpDir);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].id).toBe("def-456");
    expect(result.sessions[0].cwd).toBe("/fallback/cwd");
    expect(result.sessions[0].firstMessage).toBe("Hello world");
    expect(result.cacheUpdates).toBe(1); // wrote new .meta.json
  });

  it("should write .meta.json for uncached sessions", () => {
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_ghi-789.jsonl", { id: "ghi-789", cwd: "/new/cwd" });

    scanAllSessions(tmpDir);

    // .meta.json should now exist
    expect(fs.existsSync(metaPath(sf))).toBe(true);
    const meta = JSON.parse(fs.readFileSync(metaPath(sf), "utf-8"));
    expect(meta.cwd).toBe("/new/cwd");
    expect(meta.cachedAt).toBeGreaterThan(0);
  });

  it("should seed lastActivityAt from events.jsonl mtime (cold-start, cached meta path)", () => {
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_seed-id.jsonl", { id: "seed-id", cwd: "/seed" });
    writeSessionMeta(sf, {
      cwd: "/seed",
      status: "ended",
      startedAt: 1000,
      cachedAt: Date.now() + 10_000, // fresh cache so we hit the cached-meta arm
    });

    // Force a known mtime on the .jsonl
    const knownMtime = new Date("2026-04-15T10:00:00.000Z");
    fs.utimesSync(sf, knownMtime, knownMtime);

    const result = scanAllSessions(tmpDir);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].lastActivityAt).toBe(knownMtime.getTime());
  });

  it("should seed lastActivityAt from events.jsonl mtime (fallback parse path)", () => {
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_fallback-seed.jsonl", { id: "fallback-seed", cwd: "/seed2" });
    // No .meta.json — forces the fallback-parse arm.
    const knownMtime = new Date("2026-04-16T11:30:00.000Z");
    fs.utimesSync(sf, knownMtime, knownMtime);

    const result = scanAllSessions(tmpDir);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].lastActivityAt).toBe(knownMtime.getTime());
  });

  it("should ignore orphaned .meta.json without .jsonl", () => {
    const dir = createSessionDir("--test-cwd--");
    // Write .meta.json without a corresponding .jsonl
    const orphanedMeta = path.join(dir, "2026-03-30T21-39-43-034Z_orphan-id.meta.json");
    fs.writeFileSync(orphanedMeta, JSON.stringify({ cwd: "/ghost", source: "dashboard" }));

    const result = scanAllSessions(tmpDir);
    expect(result.sessions).toHaveLength(0);
  });

  it("should extract session ID from filename", () => {
    const dir = createSessionDir("--test-cwd--");
    createJsonl(dir, "2026-03-30T21-39-43-034Z_c7ab4be9-78d1-4764-8197-dbf74fea8bf4.jsonl", {
      id: "c7ab4be9-78d1-4764-8197-dbf74fea8bf4",
      cwd: "/test",
    });
    writeSessionMeta(
      path.join(dir, "2026-03-30T21-39-43-034Z_c7ab4be9-78d1-4764-8197-dbf74fea8bf4.jsonl"),
      { cwd: "/test", cachedAt: Date.now() + 10000 },
    );

    const result = scanAllSessions(tmpDir);
    expect(result.sessions[0].id).toBe("c7ab4be9-78d1-4764-8197-dbf74fea8bf4");
  });

  it("should re-extract stats when .jsonl is newer than cachedAt", () => {
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_stale-id.jsonl", { id: "stale-id", cwd: "/stale" });

    // Write meta with old cachedAt
    writeSessionMeta(sf, {
      cwd: "/stale",
      cost: 1.0,
      cachedAt: 1000, // very old
    });

    // Touch the .jsonl to make it newer
    const now = new Date();
    fs.utimesSync(sf, now, now);

    const result = scanAllSessions(tmpDir);
    expect(result.sessions).toHaveLength(1);
    // Stats should come from mock extractSessionStats (cost=0.5), not cached (cost=1.0)
    expect(result.sessions[0].cost).toBe(0.5);
    expect(result.cacheUpdates).toBe(1);
  });

  it("should scan multiple cwd directories", () => {
    const dir1 = createSessionDir("--project-a--");
    const dir2 = createSessionDir("--project-b--");
    createJsonl(dir1, "2026-03-30T21-39-43-034Z_id-a.jsonl", { id: "id-a", cwd: "/project/a" });
    createJsonl(dir2, "2026-03-30T21-39-43-034Z_id-b.jsonl", { id: "id-b", cwd: "/project/b" });

    const result = scanAllSessions(tmpDir);
    expect(result.sessions).toHaveLength(2);
    const ids = result.sessions.map((s) => s.id).sort();
    expect(ids).toEqual(["id-a", "id-b"]);
  });

  it("should preserve existing meta fields when falling back to .jsonl", () => {
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_preserve-id.jsonl", { id: "preserve-id", cwd: "/test" });

    // Write partial meta (source only, no cwd — triggers fallback)
    writeSessionMeta(sf, { source: "dashboard" });

    const result = scanAllSessions(tmpDir);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].source).toBe("dashboard");

    // Check the written meta preserved source
    const meta = JSON.parse(fs.readFileSync(metaPath(sf), "utf-8"));
    expect(meta.source).toBe("dashboard");
    expect(meta.cwd).toBe("/test");
  });

  it("should preserve persisted contextWindow over inferred stats value when model unchanged", () => {
    // Regression: pi's JSONL has no turn_end/contextUsage events, so
    // extractSessionStats falls back to inferContextWindow(model) which
    // hardcodes Claude → 200_000. The persisted .meta.json value (written
    // from a live turn_end carrying e.g. 1_000_000 for Sonnet 1M) must win.
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_ctx-id.jsonl", { id: "ctx-id", cwd: "/ctx" });

    writeSessionMeta(sf, {
      cwd: "/ctx",
      model: "anthropic/claude-sonnet-4-20250514",
      contextWindow: 1_000_000, // truth from a live turn_end
      cachedAt: 1000, // stale — forces re-extract
    });
    fs.utimesSync(sf, new Date(), new Date());

    const result = scanAllSessions(tmpDir);
    expect(result.sessions[0].contextWindow).toBe(1_000_000);

    // Should also persist the preserved value, not the inferred 200k.
    const meta = JSON.parse(fs.readFileSync(metaPath(sf), "utf-8"));
    expect(meta.contextWindow).toBe(1_000_000);
  });

  it("should adopt inferred contextWindow when model changes", () => {
    // If the user switched models, the persisted contextWindow no longer
    // applies — fall back to whatever stats reports for the new model.
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_chg-id.jsonl", { id: "chg-id", cwd: "/chg" });

    writeSessionMeta(sf, {
      cwd: "/chg",
      model: "openai/gpt-4o", // different model from the mock's anthropic/claude-...
      contextWindow: 128_000,
      cachedAt: 1000,
    });
    fs.utimesSync(sf, new Date(), new Date());

    const result = scanAllSessions(tmpDir);
    // Mock returns model=anthropic/claude-..., contextWindow=200000 → adopt it
    expect(result.sessions[0].model).toBe("anthropic/claude-sonnet-4-20250514");
    expect(result.sessions[0].contextWindow).toBe(200_000);
  });

  it("reconstructs gitWorktree from persisted mainPath + name", () => {
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_wt-id.jsonl", { id: "wt-id", cwd: "/repo/.worktrees/feat-x" });
    writeSessionMeta(sf, {
      cwd: "/repo/.worktrees/feat-x",
      status: "ended",
      gitWorktree: { mainPath: "/repo", name: "feat-x" },
      cachedAt: Date.now() + 10000,
    });

    const result = scanAllSessions(tmpDir);
    expect(result.sessions[0].gitWorktree?.mainPath).toBe("/repo");
    expect(result.sessions[0].gitWorktree?.name).toBe("feat-x");
  });

  it("leaves gitWorktree undefined for a legacy sidecar lacking parentage", () => {
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_legacy-id.jsonl", { id: "legacy-id", cwd: "/legacy" });
    writeSessionMeta(sf, {
      cwd: "/legacy",
      status: "ended",
      cachedAt: Date.now() + 10000,
    });

    const result = scanAllSessions(tmpDir);
    expect(result.sessions[0].gitWorktree).toBeUndefined();
  });

  it("should set hidden from meta", () => {
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_hidden-id.jsonl", { id: "hidden-id", cwd: "/test" });
    writeSessionMeta(sf, {
      cwd: "/test",
      hidden: true,
      cachedAt: Date.now() + 10000,
    });

    const result = scanAllSessions(tmpDir);
    expect(result.sessions[0].hidden).toBe(true);
  });
});

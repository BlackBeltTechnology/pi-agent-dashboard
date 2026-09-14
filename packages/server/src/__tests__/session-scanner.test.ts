import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { metaPath, writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanAllSessions } from "../session/session-scanner.js";
import { extractSessionStats } from "../session/session-stats-reader.js";

// Mock extractSessionStats to avoid needing real JSONL content with usage data
vi.mock("../session/session-stats-reader.js", () => ({
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

    // Disable the boot age rule: this test pins lastActivityAt seeding, and the
    // forced-old mtime would otherwise archive the session at scan time.
    // See change: archive-sessions-lazy-load.
    const result = scanAllSessions(tmpDir, { archiveAfterDays: 0 });
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
    // `mainPath` must be a PLAUSIBLE working tree (exists, no `.git` segment,
    // carries a `.git` entry) or the load-time phantom filter drops it — so the
    // fixture is a real directory rather than the literal `/repo`.
    // See change: add-git-checkout-root-resolver.
    const mainPath = path.join(tmpDir, "repo");
    fs.mkdirSync(path.join(mainPath, ".git"), { recursive: true });
    const cwd = path.join(mainPath, ".worktrees", "feat-x");
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_wt-id.jsonl", { id: "wt-id", cwd });
    writeSessionMeta(sf, {
      cwd,
      status: "ended",
      gitWorktree: { mainPath, name: "feat-x" },
      cachedAt: Date.now() + 10000,
    });

    const result = scanAllSessions(tmpDir);
    expect(result.sessions[0].gitWorktree?.mainPath).toBe(mainPath);
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

  it("restores isGitRepo === false from meta on cold start", () => {
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_nogit-id.jsonl", { id: "nogit-id", cwd: "/plain" });
    writeSessionMeta(sf, {
      cwd: "/plain",
      status: "ended",
      isGitRepo: false,
      cachedAt: Date.now() + 10000,
    });

    const result = scanAllSessions(tmpDir);
    expect(result.sessions[0].isGitRepo).toBe(false);
  });

  it("restores isGitRepo === true from meta on cold start", () => {
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_isgit-id.jsonl", { id: "isgit-id", cwd: "/repo" });
    writeSessionMeta(sf, {
      cwd: "/repo",
      status: "ended",
      isGitRepo: true,
      cachedAt: Date.now() + 10000,
    });

    const result = scanAllSessions(tmpDir);
    expect(result.sessions[0].isGitRepo).toBe(true);
  });

  it("leaves isGitRepo undefined for a legacy sidecar lacking the field", () => {
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_legacygit-id.jsonl", { id: "legacygit-id", cwd: "/legacy" });
    writeSessionMeta(sf, {
      cwd: "/legacy",
      status: "ended",
      cachedAt: Date.now() + 10000,
    });

    const result = scanAllSessions(tmpDir);
    expect(result.sessions[0].isGitRepo).toBeUndefined();
  });

  it("restores tags from meta on cold start", () => {
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_tags-id.jsonl", { id: "tags-id", cwd: "/test" });
    writeSessionMeta(sf, {
      cwd: "/test",
      status: "ended",
      tags: ["feature", "backend"],
      cachedAt: Date.now() + 10000,
    });

    const result = scanAllSessions(tmpDir);
    expect(result.sessions[0].tags).toEqual(["feature", "backend"]);
  });

  it("leaves tags undefined for a legacy sidecar lacking the field", () => {
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_notags-id.jsonl", { id: "notags-id", cwd: "/legacy" });
    writeSessionMeta(sf, { cwd: "/legacy", status: "ended", cachedAt: Date.now() + 10000 });

    const result = scanAllSessions(tmpDir);
    expect(result.sessions[0].tags).toBeUndefined();
  });

  it("migrates an ended hidden sidecar to archived (one-shot)", () => {
    const dir = createSessionDir("--test-cwd--");
    const sf = createJsonl(dir, "2026-03-30T21-39-43-034Z_hidden-id.jsonl", { id: "hidden-id", cwd: "/test" });
    writeSessionMeta(sf, {
      cwd: "/test",
      hidden: true,
      status: "ended",
      endedAt: 4242,
      cachedAt: Date.now() + 10000,
    });

    const result = scanAllSessions(tmpDir);
    // Migrated: not restored, indexed, `hidden` left untouched on disk.
    expect(result.sessions).toEqual([]);
    expect(result.migrated).toBe(1);
    expect(result.archived.map((r) => r.id)).toContain("hidden-id");
    const onDisk = JSON.parse(fs.readFileSync(metaPath(sf), "utf-8"));
    expect(onDisk).toMatchObject({ archived: true, archivedAt: 4242, hidden: true });

    // Second scan is a no-op rewrite (idempotent).
    const second = scanAllSessions(tmpDir);
    expect(second.migrated).toBe(0);
    expect(second.sessions).toEqual([]);
  });
});

// ── boot archive decision table + one-shot migration ────────────────────────
//
// Covers test-plan #E10 (migration decision table), #E11 (one-shot), #E12
// (archived sidecars skip stats extraction), #E20 (boot scan age table) and
// #X7 (corrupt sidecar). See change: archive-sessions-lazy-load.

const DAY = 86_400_000;

describe("boot archive decision table (E10, E20)", () => {
  let root: string;
  let dir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-archive-"));
    dir = path.join(root, "--repo--");
    fs.mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** Seed one `<ts>_<id>.jsonl` + sidecar; optionally force the jsonl mtime. */
  function seed(id: string, meta: Record<string, unknown>, mtimeMs?: number): string {
    const file = path.join(dir, `2026-03-30T21-39-43-034Z_${id}.jsonl`);
    fs.writeFileSync(
      file,
      `${JSON.stringify({ type: "session", id, cwd: "/repo" })}\n`,
    );
    writeSessionMeta(file, { cwd: "/repo", ...meta } as never);
    if (mtimeMs !== undefined) {
      const t = new Date(mtimeMs);
      fs.utimesSync(file, t, t);
    }
    return file;
  }

  const bySession = (result: ReturnType<typeof scanAllSessions>, id: string) =>
    result.sessions.find((s) => s.id === id);

  it("E10: hidden→archived, hidden+live→restored, already-archived→indexed, young→restored visible", () => {
    const now = Date.now();
    const fresh = now + 10 * DAY; // far-future cachedAt ⇒ cache-fresh arm

    // #1 hidden, not live, status idle → migrated to archived, hidden kept.
    const f1 = seed("mig-hidden", { hidden: true, status: "idle", endedAt: 4242, cachedAt: fresh });
    // #2 hidden AND live → never archived, restored still hidden, disk untouched.
    const f2 = seed("live-hidden", { hidden: true, live: true, status: "idle", endedAt: 4242, cachedAt: fresh });
    // #3 already archived → indexed only, never rewritten.
    const f3 = seed("already", { hidden: true, archived: true, archivedAt: 9000, endedAt: 8000, cachedAt: fresh });
    // #4 no hidden, ended 10 d ago (< 30 d threshold) → restored visible.
    seed("young", { status: "ended", endedAt: now - 10 * DAY, cachedAt: fresh });

    const before2 = fs.readFileSync(metaPath(f2), "utf-8");
    const before3 = fs.readFileSync(metaPath(f3), "utf-8");

    const result = scanAllSessions(root, { archiveAfterDays: 30, now });

    // #1 — rewritten with archive fields, `hidden` preserved, not restored.
    expect(JSON.parse(fs.readFileSync(metaPath(f1), "utf-8"))).toMatchObject({
      archived: true,
      archivedAt: 4242,
      hidden: true,
    });
    expect(bySession(result, "mig-hidden")).toBeUndefined();
    expect(result.archived.map((r) => r.id)).toContain("mig-hidden");
    expect(result.migrated).toBe(1);
    expect(result.agedOut).toBe(0);

    // #2 — live wins over the migration: restored, still hidden, disk unchanged.
    expect(bySession(result, "live-hidden")).toMatchObject({ hidden: true, live: true });
    expect(result.archived.map((r) => r.id)).not.toContain("live-hidden");
    expect(fs.readFileSync(metaPath(f2), "utf-8")).toBe(before2);

    // #3 — indexed from the sidecar as-is, no rewrite.
    expect(bySession(result, "already")).toBeUndefined();
    expect(result.archived.find((r) => r.id === "already")).toMatchObject({
      endedAt: 8000,
      archivedAt: 9000,
    });
    expect(fs.readFileSync(metaPath(f3), "utf-8")).toBe(before3);

    // #4 — young non-hidden history is restored VISIBLE.
    expect(bySession(result, "young")).toMatchObject({ hidden: false });
    expect(result.archived.map((r) => r.id)).not.toContain("young");
  });

  it("E20: aged idle-not-live archived at scan; restoredAt and live keep a 45 d session resident", () => {
    const now = Date.now();
    const fresh = now + 10 * DAY;

    // #1 status idle, live:false, no endedAt, jsonl mtime 45 d old → aged out.
    seed("aged-idle", { status: "idle", live: false, cachedAt: fresh }, now - 45 * DAY);
    // #2 ended 45 d ago but restored 2 d ago → the restore clock wins.
    seed("restored", { status: "ended", endedAt: now - 45 * DAY, restoredAt: now - 2 * DAY, cachedAt: fresh });
    // #3 ended 45 d ago but live:true → recovery candidate, never archived.
    seed("live-old", { status: "ended", endedAt: now - 45 * DAY, live: true, cachedAt: fresh });

    const result = scanAllSessions(root, { archiveAfterDays: 30, now });

    expect(result.agedOut).toBe(1);
    expect(result.migrated).toBe(0);
    expect(result.archived.map((r) => r.id)).toEqual(["aged-idle"]);
    expect(bySession(result, "aged-idle")).toBeUndefined();

    expect(bySession(result, "restored")).toBeDefined();
    expect(bySession(result, "live-old")).toMatchObject({ live: true });

    // The scan reports archive transitions as DATA only — it owns no emitter,
    // so no `session_archived` frame can originate here.
    expect(Object.keys(result)).toEqual(
      expect.arrayContaining(["sessions", "archived", "migrated", "agedOut", "cacheUpdates"]),
    );
  });

  it("E11: a second scan rewrites no sidecar", () => {
    const now = Date.now();
    const fresh = now + 10 * DAY;
    seed("mig-hidden", { hidden: true, status: "idle", endedAt: 4242, cachedAt: fresh });
    seed("live-hidden", { hidden: true, live: true, status: "idle", endedAt: 4242, cachedAt: fresh });
    seed("already", { hidden: true, archived: true, archivedAt: 9000, endedAt: 8000, cachedAt: fresh });
    seed("young", { status: "ended", endedAt: now - 10 * DAY, cachedAt: fresh });

    // `mergeSessionMeta` calls `writeSessionMeta` INTERNALLY, so an ESM spy on
    // the exported binding cannot see the migration write. Spy one level down,
    // on the atomic sidecar write itself.
    const writeSpy = vi.spyOn(fs, "writeFileSync");
    const sidecarWrites = () =>
      writeSpy.mock.calls.filter(([p]) => String(p).includes(".meta.json")).length;

    const first = scanAllSessions(root, { archiveAfterDays: 30, now });
    expect(first.migrated).toBe(1);
    expect(sidecarWrites()).toBeGreaterThan(0); // the one-shot migration wrote

    const snapshot = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".meta.json"))
      .map((f) => [f, fs.readFileSync(path.join(dir, f), "utf-8")] as const);
    writeSpy.mockClear();

    const second = scanAllSessions(root, { archiveAfterDays: 30, now });

    expect(sidecarWrites()).toBe(0);
    expect(second.migrated).toBe(0);
    expect(second.agedOut).toBe(0);
    expect(second.cacheUpdates).toBe(0);
    // Byte-identical sidecars, so "no write" is not merely "no observed call".
    for (const [name, content] of snapshot) {
      expect(fs.readFileSync(path.join(dir, name), "utf-8"), name).toBe(content);
    }
    writeSpy.mockRestore();
  });

  it("E12: an archived sidecar is indexed without extracting stats from its .jsonl", () => {
    const now = Date.now();
    const archivedFile = seed("arch-1", {
      archived: true,
      archivedAt: 9000,
      endedAt: 8000,
      cachedAt: 1000, // stale on purpose: the archived arm must short-circuit first
    });
    const residentFile = seed("res-1", { status: "ended", endedAt: now - DAY, cachedAt: 1000 });
    const touch = new Date(now);
    fs.utimesSync(archivedFile, touch, touch);
    fs.utimesSync(residentFile, touch, touch);

    const stats = vi.mocked(extractSessionStats);
    stats.mockClear();

    const result = scanAllSessions(root, { archiveAfterDays: 30, now });

    const scanned = stats.mock.calls.map(([f]) => f);
    expect(scanned).not.toContain(archivedFile);
    // The stale resident sidecar DOES get re-extracted — proof the skip is
    // specific to the archived row, not a globally disabled reader.
    expect(scanned).toContain(residentFile);
    expect(result.archived.map((r) => r.id)).toContain("arch-1");
  });

  it("X7: a corrupt sidecar falls back to the .jsonl header and is not archived", () => {
    const file = path.join(dir, "2026-03-30T21-39-43-034Z_corrupt-1.jsonl");
    fs.writeFileSync(
      file,
      `${[
        JSON.stringify({ type: "session", id: "corrupt-1", cwd: "/repo" }),
        JSON.stringify({ type: "message", message: { role: "user", content: "Hello world" } }),
      ].join("\n")}\n`,
    );
    fs.writeFileSync(metaPath(file), "{ this is not json");

    let result!: ReturnType<typeof scanAllSessions>;
    expect(() => {
      result = scanAllSessions(root, { archiveAfterDays: 30, now: Date.now() });
    }).not.toThrow();

    expect(result.sessions.map((s) => s.id)).toEqual(["corrupt-1"]);
    expect(result.sessions[0]).toMatchObject({ cwd: "/repo", firstMessage: "Hello world" });
    expect(result.archived).toEqual([]);
    // The sidecar is rebuilt as valid JSON carrying no archive fields.
    const rebuilt = JSON.parse(fs.readFileSync(metaPath(file), "utf-8"));
    expect(rebuilt.cwd).toBe("/repo");
    expect(rebuilt.archived).toBeUndefined();
  });
});

// ── P1: first-boot soak — the archive line the operator reads ────────────────
//
// Observation-only (no threshold, per the test-plan clarification): boot a real
// server over 3000 aged sidecars and pin the single summary line.
// See change: archive-sessions-lazy-load.
describe("first-boot archive log line (P1)", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-boot-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("logs `archive: N indexed, M migrated, K aged-out (Xms)` covering all 3000 sidecars", async () => {
    const now = Date.now();
    const dir = path.join(root, "--repo--");
    fs.mkdirSync(dir, { recursive: true });
    const aged = new Date(now - 45 * DAY);
    for (let i = 0; i < 3000; i++) {
      const id = `boot-${String(i).padStart(4, "0")}`;
      const file = path.join(dir, `2026-03-30T21-39-43-034Z_${id}.jsonl`);
      fs.writeFileSync(file, `${JSON.stringify({ type: "session", id, cwd: "/repo" })}\n`);
      // Half migrate (ended+hidden), half age out — M + K must cover all 3000.
      writeSessionMeta(file, {
        cwd: "/repo",
        status: "ended",
        endedAt: now - 45 * DAY,
        cachedAt: now + 10 * DAY,
        ...(i % 2 === 0 ? { hidden: true } : {}),
      } as never);
      fs.utimesSync(file, aged, aged);
    }

    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", root);
    const infos: string[] = [];
    const infoSpy = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      infos.push(args.map(String).join(" "));
    });

    const { createServer } = await import("../server.js");
    const server = await createServer({
      port: 0,
      piPort: 0,
      host: "127.0.0.1",
      dev: true,
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
    });
    try {
      const line = infos.find((l) => l.includes("archive:"));
      expect(line, `archive line missing from: ${infos.join(" | ")}`).toBeDefined();
      const m = /archive: (\d+) indexed, (\d+) migrated, (\d+) aged-out \((\d+) ms\)/.exec(line!);
      expect(m, `unexpected archive line shape: ${line}`).not.toBeNull();
      const [, indexed, migrated, agedOut, durationMs] = m!.map(Number);
      expect(indexed).toBe(3000);
      expect(migrated + agedOut).toBe(3000);
      // Duration logged, no threshold (P1 is observational).
      expect(Number.isFinite(durationMs)).toBe(true);
      expect(durationMs).toBeGreaterThanOrEqual(0);
      // Non-residency is the point of the boot scan: none of the 3000 loaded.
      expect(server.sessionManager.listAll().map((s) => s.id).filter((id) => id.startsWith("boot-")))
        .toEqual([]);
    } finally {
      infoSpy.mockRestore();
      await server.stop();
    }
  }, 60_000);
});

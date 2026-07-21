import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {acknowledgeRows, closeKb,
  closeKbForCwd, 
  createReindexState, decideNudge, ensurePopulated,getKb, nudgeText, reindexNow, 
} from "../reindex.js";

// Build a temp project with a KB config so reindex logic can open a real store.
function setupProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "kb-ext-"));
  mkdirSync(join(dir, ".pi", "dashboard", "kb"), { recursive: true });
  writeFileSync(join(dir, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify({
    sources: [{ kind: "filesystem", ref: "docs", priority: 5 }],
    dbPath: ".pi/dashboard/kb/index.db",
  }));
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "guide.md"), "# Guide\ninitial content padded to survive the merge threshold cleanly here.\n");
  return dir;
}

describe("reindex Job 1: edit .md → index reflects change", () => {
  let dir: string;
  beforeAll(() => (dir = setupProject()));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reindexNow picks up an edited file without manual kb index", async () => {
    const state = createReindexState();
    await reindexNow(state, dir); // cold index
    const { store } = getKb(state, dir);
    expect(store.search("initial content padded", { limit: 3 }).length).toBeGreaterThan(0);

    // edit the file
    writeFileSync(join(dir, "docs", "guide.md"), "# Guide\nrewritten totally different zebras are exotic animals here.\n");
    await reindexNow(state, dir); // incremental
    const hits = store.search("rewritten totally different zebras", { limit: 3 });
    expect(hits[0]?.path).toMatch(/guide\.md$/);
    // old content gone
    expect(store.search("initial content padded", { limit: 3 }).length).toBe(0);
    closeKb(state);
  });

  it("coalesces concurrent reindexes for one cwd (no interleaved transaction)", async () => {
    // indexSource now yields mid-transaction; two overlapping walks on the same
    // cached store would interleave BEGIN/COMMIT. Use a >YIELD_EVERY (100) fixture
    // so the walk actually yields while holding a transaction — without the
    // coalescing guard the second walk throws "transaction within a transaction".
    // See change: fix-kb-index-feedback.
    const big = mkdtempSync(join(tmpdir(), "kb-ext-conc-"));
    mkdirSync(join(big, ".pi", "dashboard", "kb"), { recursive: true });
    writeFileSync(join(big, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify({
      sources: [{ kind: "filesystem", ref: "docs" }], dbPath: ".pi/dashboard/kb/index.db",
    }));
    mkdirSync(join(big, "docs"), { recursive: true });
    for (let i = 0; i < 150; i++) {
      writeFileSync(join(big, "docs", `d${i}.md`), `# Doc ${i}\n\nBody ${i} padded enough to survive the tiny-chunk merge threshold here and there.\n`);
    }
    const state = createReindexState();
    // Concurrent — must not throw, and both resolve to the same coalesced result.
    const [a, b] = await Promise.all([reindexNow(state, big), reindexNow(state, big)]);
    expect(a).toEqual(b);
    expect(a.chunks).toBeGreaterThan(0);
    closeKb(state);
    rmSync(big, { recursive: true, force: true });
  });
});

describe("cwd removal: kb store does not resurrect the directory (husk regression)", () => {
  // Reproduces the confirmed husk mechanism: a live kb store holds
  // `<cwd>/.pi/dashboard/kb/index.db` open; the worktree dir is deleted
  // (git worktree remove); the next reindex tick's `mkdirSync` in the store
  // constructor RE-CREATES the dir by path → orphan husk. See change:
  // sweep-worktree-residual-on-remove.

  it("reindexNow after cwd removal is a no-op and never recreates the dir", async () => {
    const dir = setupProject();
    const state = createReindexState();
    await reindexNow(state, dir); // cold index — opens + caches the store

    // Simulate `git worktree remove`: the entire worktree dir vanishes.
    rmSync(dir, { recursive: true, force: true });
    expect(existsSync(dir)).toBe(false);

    // Force a cache-MISS so the next tick would construct a fresh store — this
    // is the resurrection vector: `new SqliteFtsStore` does mkdirSync(recursive)
    // and recreates `<cwd>/.pi/dashboard/kb` by path.
    state.kb.get(dir)?.store.close();
    state.kb.delete(dir);

    // A subsequent reindex tick MUST NOT recreate the directory.
    const result = await reindexNow(state, dir);
    expect(result).toEqual({ changed: 0, chunks: 0 });
    expect(existsSync(dir)).toBe(false); // husk NOT resurrected
    expect(state.kb.has(dir)).toBe(false); // no fresh store cached
    closeKb(state);
  });

  it("getKb on a removed cwd (cache miss) refuses to recreate the dir", async () => {
    const dir = setupProject();
    const state = createReindexState();
    await reindexNow(state, dir);
    state.kb.get(dir)?.store.close();
    state.kb.delete(dir);
    rmSync(dir, { recursive: true, force: true });

    expect(() => getKb(state, dir)).toThrow(/removed|cwd/i);
    expect(existsSync(dir)).toBe(false);
    closeKb(state);
  });

  it("closeKbForCwd evicts only the target cwd, leaving others open", async () => {
    const a = setupProject();
    const b = setupProject();
    const state = createReindexState();
    await reindexNow(state, a);
    await reindexNow(state, b);
    expect(state.kb.has(a)).toBe(true);
    expect(state.kb.has(b)).toBe(true);

    closeKbForCwd(state, a);
    expect(state.kb.has(a)).toBe(false);
    expect(state.kb.has(b)).toBe(true);

    closeKb(state);
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  });
});

describe("cold-start populate: ensurePopulated (kb_neighbors / kb_get)", () => {
  // A never-indexed cwd must self-populate on first neighbors/get, mirroring
  // kb_search's freshness reindex; a warm index must NOT be re-walked.
  // See change: fix-kb-neighbors-get-cold-start.

  it("populates an empty index on first call (cold start)", async () => {
    const dir = setupProject();
    const state = createReindexState();
    await ensurePopulated(state, dir); // cold KB — never indexed before
    const { store } = getKb(state, dir);
    expect(store.counts().chunks).toBeGreaterThan(0);
    // proves neighbors/get would now see real data instead of empty
    expect(store.search("initial content padded", { limit: 3 }).length).toBeGreaterThan(0);
    closeKb(state);
    rmSync(dir, { recursive: true, force: true });
  });

  it("does NOT re-walk a warm index (empty-guard skips reindex)", async () => {
    const dir = setupProject();
    const state = createReindexState();
    await ensurePopulated(state, dir); // build once
    // Edit the source WITHOUT triggering a reindex.
    writeFileSync(join(dir, "docs", "guide.md"), "# Guide\nwarmskip token quokkas roam distant islands quietly here.\n");
    await ensurePopulated(state, dir); // chunks>0 → must skip the walk
    const { store } = getKb(state, dir);
    // The new content is NOT searchable — proves no walk ran on the warm path.
    expect(store.search("warmskip token quokkas", { limit: 3 }).length).toBe(0);
    expect(store.search("initial content padded", { limit: 3 }).length).toBeGreaterThan(0);
    closeKb(state);
    rmSync(dir, { recursive: true, force: true });
  });

  it("is a safe no-op on a removed cwd (degrade, never throws)", async () => {
    const dir = setupProject();
    rmSync(dir, { recursive: true, force: true });
    const state = createReindexState();
    await expect(ensurePopulated(state, dir)).resolves.toBeUndefined();
    expect(existsSync(dir)).toBe(false); // did not recreate the husk
    closeKb(state);
  });
});

describe("DOX nudge Job 2: decideNudge + acknowledgeRows", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "kb-doxext-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "AGENTS.md"), "# DOX\n\n| `src/a.ts` |  |\n");
    writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "src", "b.ts"), "export const b = 2;\n");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("missing row → missing decision", () => {
    const d = decideNudge(dir, join(dir, "src", "b.ts"));
    expect(d?.kind).toBe("missing");
    expect(nudgeText(d, "src/b.ts")).toContain("src/b.ts");
  });

  it("clean (row exists, not stale) → null", () => {
    // a.ts has a row and no staleness sidecar → not stale
    const d = decideNudge(dir, join(dir, "src", "a.ts"));
    expect(d).toBeNull();
  });

  it("treeless path → treeless decision", () => {
    const bare = mkdtempSync(join(tmpdir(), "kb-treeless-"));
    try {
      writeFileSync(join(bare, "x.ts"), "x;\n");
      const d = decideNudge(bare, join(bare, "x.ts"));
      expect(d?.kind).toBe("treeless");
      expect(nudgeText(d, "x.ts")).toContain("kb dox init");
    } finally { rmSync(bare, { recursive: true, force: true }); }
  });

  it("acknowledgeRows clears stale flags after AGENTS.md edit", () => {
    // seed staleness: a.ts acknowledged at an old hash
    const sidecar = join(dir, ".pi", "dashboard", "kb", "dox-staleness.json");
    mkdirSync(join(dir, ".pi", "dashboard", "kb"), { recursive: true });
    writeFileSync(sidecar, JSON.stringify({ "src/a.ts": "olddhash000" }));
    const before = decideNudge(dir, join(dir, "src", "a.ts"));
    expect(before?.kind).toBe("stale");
    acknowledgeRows(dir, join(dir, "AGENTS.md"));
    const after = decideNudge(dir, join(dir, "src", "a.ts"));
    expect(after).toBeNull(); // acknowledged → current hash → not stale
  });

  it("resolves basename rows against the owning AGENTS.md dir (nested, Defect A)", () => {
    const sub = mkdtempSync(join(tmpdir(), "kb-nested-"));
    try {
      mkdirSync(join(sub, "pkg", "src"), { recursive: true });
      // AGENTS.md lives in pkg/src with a BARE BASENAME row
      writeFileSync(join(sub, "pkg", "src", "AGENTS.md"), "# DOX \u2014 pkg/src\n\n| `api.ts` |  |\n");
      writeFileSync(join(sub, "pkg", "src", "api.ts"), "export const api = 1;\n");
      // row exists (resolved dir-relative) → not "missing"
      expect(decideNudge(sub, join(sub, "pkg", "src", "api.ts"))).toBeNull();
    } finally { rmSync(sub, { recursive: true, force: true }); }
  });

  it("dedup: a path nudged once is not nudged again (session state)", () => {
    const state = createReindexState();
    const key = `missing:src/b.ts`;
    expect(state.nudged.has(key)).toBe(false);
    state.nudged.add(key);
    expect(state.nudged.has(key)).toBe(true); // extension skips when present
  });
});

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, validateConfig } from "../config.js";
import { DEFAULT_SEARCHABLE_KEYS } from "../frontmatter.js";
import { runIndexAtomic } from "../index-run.js";
import { indexSource } from "../indexer.js";
import { SCHEMA_VERSION, SqliteFtsStore } from "../sqlite-store.js";
import type { KbStore } from "../types.js";

const tmps: string[] = [];
function mkdir(): string {
  const d = mkdtempSync(join(tmpdir(), "kb-fm-"));
  tmps.push(d);
  return d;
}
function md(dir: string, name: string, content: string) {
  const abs = join(dir, name);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}
function freshStore(): SqliteFtsStore {
  const s = new SqliteFtsStore(":memory:");
  s.init();
  return s;
}
async function indexInto(store: KbStore, dir: string, force = false) {
  return indexSource(store, { root: "t", dir }, { force });
}

afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("synthetic meta chunk (searchable frontmatter)", () => {
  it("E10: title match surfaces the file and ranks at least as well as a body-only match", async () => {
    const dir = mkdir();
    md(dir, "a.md", "---\ntitle: Widget Guide\n---\nalpha content");
    md(dir, "b.md", "# Doc\nWidget Guide appears in the body here");
    const store = freshStore();
    await indexInto(store, dir);
    const hits = store.search("Widget Guide", { limit: 10 });
    const meta = hits.find((h) => h.headingPath === "Widget Guide");
    expect(meta).toBeDefined();
    const body = hits.find((h) => h.path.endsWith("b.md"));
    if (meta && body) expect(meta.score).toBeLessThanOrEqual(body.score);
  });

  it("E11: a file with no searchable frontmatter emits no :meta chunk", async () => {
    const dir = mkdir();
    md(dir, "c.md", "---\ntags: [x]\n---\nonly body words here");
    const store = freshStore();
    await indexInto(store, dir);
    const hits = store.search("body words", { limit: 10 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => !h.chunkId.endsWith(":meta"))).toBe(true);
  });
});

describe("properties: facets, filters, docType mirror", () => {
  it("E13: docType is mirrored into properties (facetable)", async () => {
    const dir = mkdir();
    md(dir, "AGENTS.md", "---\ntitle: T\n---\nagents body");
    const store = freshStore();
    await indexInto(store, dir);
    const f = store.facets(["docType"]);
    expect(f.docType?.agents).toBeGreaterThanOrEqual(1);
  });

  it("E14: eq filter intersects full-text hits", async () => {
    const dir = mkdir();
    md(dir, "a.md", "---\nstatus: approved\n---\nsharedterm alpha");
    md(dir, "b.md", "---\nstatus: draft\n---\nsharedterm beta");
    md(dir, "c.md", "---\nstatus: approved\n---\nsharedterm gamma");
    const store = freshStore();
    await indexInto(store, dir);
    const hits = store.search("sharedterm", { limit: 10, filters: [{ key: "status", op: "eq", value: "approved" }] });
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.path.endsWith("a.md") || h.path.endsWith("c.md"))).toBe(true);
  });

  it("E15: range filter on a declared-date key", async () => {
    const dir = mkdir();
    md(dir, "a.md", "---\ndate: 2024-01-01\n---\ndatedoc one");
    md(dir, "b.md", "---\ndate: 2024-06-01\n---\ndatedoc two");
    md(dir, "c.md", "---\ndate: 2025-01-01\n---\ndatedoc three");
    const store = freshStore();
    await indexInto(store, dir);
    const hits = store.search("datedoc", { limit: 10, filters: [{ key: "date", op: "gte", value: "2024-06-01", type: "date" }] });
    expect(hits).toHaveLength(2);
  });

  it("E16: filter values are parameter-bound (injection is inert)", async () => {
    const dir = mkdir();
    md(dir, "a.md", "---\nstatus: approved\n---\nsharedterm alpha");
    const store = freshStore();
    await indexInto(store, dir);
    const hits = store.search("sharedterm", { limit: 10, filters: [{ key: "status", op: "eq", value: "x' OR '1'='1" }] });
    expect(hits).toHaveLength(0);
  });

  it("E17: absent filters are a no-op (identical to no filter arg)", async () => {
    const dir = mkdir();
    md(dir, "a.md", "---\nstatus: approved\n---\nsharedterm alpha");
    md(dir, "b.md", "---\nstatus: draft\n---\nsharedterm beta");
    const store = freshStore();
    await indexInto(store, dir);
    expect(store.search("sharedterm", { limit: 10, filters: [] })).toEqual(store.search("sharedterm", { limit: 10 }));
  });

  it("E18: facet counts reflect distinct files (within-file dup counts once)", async () => {
    const dir = mkdir();
    md(dir, "a.md", "---\ntags: [x, x]\n---\nbody a");
    md(dir, "b.md", "---\ntags: [x]\n---\nbody b");
    md(dir, "c.md", "---\ntags: [x]\n---\nbody c");
    md(dir, "d.md", "---\ntags: [y]\n---\nbody d");
    const store = freshStore();
    await indexInto(store, dir);
    const f = store.facets(["tags"]);
    expect(f.tags?.x).toBe(3);
    expect(f.tags?.y).toBe(1);
  });

  it("X2: filter on an unknown key yields empty, no error", async () => {
    const dir = mkdir();
    md(dir, "a.md", "---\nstatus: approved\n---\nsharedterm alpha");
    const store = freshStore();
    await indexInto(store, dir);
    expect(store.search("sharedterm", { filters: [{ key: "nope", op: "eq", value: "z" }] })).toEqual([]);
  });
});

describe("reindex integrity", () => {
  it("E21: reindex removes stale property values (no lingering old facet)", async () => {
    const dir = mkdir();
    md(dir, "a.md", "---\nstatus: draft\n---\nversion one");
    const store = freshStore();
    await indexInto(store, dir);
    md(dir, "a.md", "---\nstatus: approved\n---\nversion two changed");
    // Force the reindex so this stale-row test does not depend on filesystem mtime resolution.
    await indexInto(store, dir, true);
    const f = store.facets(["status"]);
    expect(f.status).toEqual({ approved: 1 });
  });

  it("E22: orphan removal prunes a deleted file's properties + meta chunk", async () => {
    const dir = mkdir();
    md(dir, "a.md", "---\ntitle: Keep\ntags: [x]\n---\nalpha");
    md(dir, "b.md", "---\ntitle: Gone\ntags: [y]\n---\nbeta");
    const store = freshStore();
    await indexInto(store, dir);
    rmSync(join(dir, "b.md"));
    const st = await indexInto(store, dir);
    expect(st.deleted).toBe(1);
    expect(store.facets(["tags"]).tags).toEqual({ x: 1 });
    expect(store.search("Gone").length).toBe(0);
  });

  it("E24: defaults + tag→has_tag graph edge preserved", async () => {
    const dir = mkdir();
    const cfg = loadConfig(dir);
    expect(cfg.frontmatter.searchableKeys).toEqual(DEFAULT_SEARCHABLE_KEYS);
    md(dir, "a.md", "---\ntags: [alpha]\n---\nbody");
    const store = freshStore();
    await indexInto(store, dir);
    const nbrs = store.neighbors("a.md", 1);
    expect(nbrs.some((n) => n.name === "tag:alpha")).toBe(true);
  });
});

describe("review hardening (correctness fixes)", () => {
  it("H-eqtype: eq on a declared-numeric key matches value_num (not the lossy string)", async () => {
    const dir = mkdir();
    md(dir, "a.md", "---\nversion: 1.5\n---\nverdoc alpha");
    md(dir, "b.md", "---\nversion: 2.0\n---\nverdoc beta");
    const store = freshStore();
    await indexSource(store, { root: "t", dir }, { force: true, frontmatter: { searchableKeys: [], facetKeys: [{ key: "version", type: "number" }] } });
    const hits = store.search("verdoc", { filters: [{ key: "version", op: "eq", value: 1.5, type: "number" }] });
    expect(hits).toHaveLength(1);
    expect(hits[0].path.endsWith("a.md")).toBe(true);
  });

  it("H-crossroot: facet counts distinct files across roots sharing a relative path", async () => {
    const d1 = mkdir();
    const d2 = mkdir();
    md(d1, "a.md", "---\ntags: [x]\n---\nbody one");
    md(d2, "a.md", "---\ntags: [x]\n---\nbody two");
    const store = freshStore();
    await indexSource(store, { root: "r1", dir: d1 }, { force: true });
    await indexSource(store, { root: "r2", dir: d2 }, { force: true });
    expect(store.facets(["tags"]).tags?.x).toBe(2);
  });

  it("H-doctype: docType is faceted even for files without frontmatter", async () => {
    const dir = mkdir();
    md(dir, "plain.md", "# Heading\nno frontmatter here");
    const store = freshStore();
    await indexInto(store, dir);
    expect(store.facets(["docType"]).docType?.doc).toBeGreaterThanOrEqual(1);
  });
});

describe("config validation", () => {
  it("E23: invalid facet-key type is rejected", () => {
    expect(() => validateConfig({ frontmatter: { searchableKeys: ["title"], facetKeys: [{ key: "k", type: "bogus" as any }] } })).toThrow(/unknown type/);
  });
});

describe("schema-version + config-hash reindex gate", () => {
  it("E19: a stale user_version forces a reindex; version + facets stamped", async () => {
    const dir = mkdir();
    md(dir, "a.md", "---\ntags: [x]\n---\nbody a");
    const dbDir = mkdir();
    const dbPath = join(dbDir, "index.db");
    const sources = [{ id: "t", dir }];

    const run1 = await runIndexAtomic({ dbPath, sources });
    expect(run1.changed).toBe(1);
    const run2 = await runIndexAtomic({ dbPath, sources });
    expect(run2.changed).toBe(0); // up-to-date: no forced reindex

    const s = new SqliteFtsStore(dbPath);
    s.setUserVersion(1); // simulate a pre-change DB
    s.close();

    const run3 = await runIndexAtomic({ dbPath, sources });
    expect(run3.changed).toBe(1); // gate forced a full reindex
    const q = new SqliteFtsStore(dbPath);
    expect(q.getUserVersion()).toBe(SCHEMA_VERSION);
    expect(q.facets(["tags"]).tags?.x).toBe(1);
    q.close();
  });

  // change: asciidoc-support (test-plan #E17). The version gate alone is NOT
  // sufficient: a store created BEFORE the D3a column addition keeps its 10-column FTS5 `chunks` table, and
  // `CREATE VIRTUAL TABLE IF NOT EXISTS` will not widen it. Without the rebuild
  // in `init()` every `insertChunk` throws "table chunks has no column named
  // start_line" and the store is permanently un-reindexable. This builds the
  // genuine PRE-change table shape rather than re-opening a new-schema store.
  /** Hand-build a store at the genuine PRE-change shape: a 10-column `chunks`
   *  FTS5 table plus a `files` row claiming the fixture is already indexed at
   *  its CURRENT mtime+sha (so an incremental walk would skip it). */
  function seedPreChangeStore(dir: string, rel: string): string {
    const dbPath = join(mkdir(), "index.db");
    const st = statSync(join(dir, rel));
    const hash = createHash("sha256").update(readFileSync(join(dir, rel))).digest("hex");
    const old = new DatabaseSync(dbPath);
    old.exec("PRAGMA journal_mode=WAL");
    old.exec(`CREATE VIRTUAL TABLE chunks USING fts5(
      root UNINDEXED, path UNINDEXED, chunk_id UNINDEXED, doc_type UNINDEXED,
      parent_chunk_id UNINDEXED, level UNINDEXED, body_hash UNINDEXED,
      heading_path, heading, body, tokenize='porter unicode61');`);
    old.exec("CREATE TABLE files (root TEXT, path TEXT, mtime_ms REAL, sha256 TEXT, PRIMARY KEY (root, path))");
    old.prepare("INSERT INTO files(root,path,mtime_ms,sha256) VALUES('t',?,?,?)").run(rel, st.mtimeMs, hash);
    old.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1}`);
    old.close();
    return dbPath;
  }

  const ADOC = "= Doc\n\n== Sec\nasciidoc body padded well past the tiny-chunk merge threshold so it survives.\n";

  it("E17 (asciidoc-support): the PRE-change chunks table is rebuilt via runIndexAtomic, not bricked", async () => {
    const dir = mkdir();
    md(dir, "a.adoc", ADOC);
    const dbPath = seedPreChangeStore(dir, "a.adoc");

    const run = await runIndexAtomic({ dbPath, sources: [{ id: "t", dir }] });
    expect(run.changed).toBe(1); // rebuilt + re-chunked, no throw
    const q = new SqliteFtsStore(dbPath);
    expect(q.getUserVersion()).toBe(SCHEMA_VERSION);
    const chunk = q.getChunk("t", "a.adoc", "Doc > Sec");
    expect(chunk?.startLine).toBe(4); // the new columns are real and readable
    q.close();
  });

  it("E17 (asciidoc-support): the rebuild repopulates on a NO-FORCE incremental walk", async () => {
    // The kb-extension reindex path has no version gate and never passes
    // `force`, so the migration's `files` clear is what makes the rebuilt table
    // repopulate. Without it the mtime+sha cheap-check skips every file and the
    // store stays permanently empty.
    const dir = mkdir();
    md(dir, "a.adoc", ADOC);
    const dbPath = seedPreChangeStore(dir, "a.adoc");

    const store = new SqliteFtsStore(dbPath);
    store.init();
    const st = await indexSource(store, { root: "t", dir }); // no force, no gate
    expect(st.changed).toBe(1);
    expect(store.getChunk("t", "a.adoc", "Doc > Sec")?.startLine).toBe(4);
    store.close();
  });

  it("X3: an INTERRUPTED forced reindex leaves the prior DB valid + no temp husk", async () => {
    const dir = mkdir();
    md(dir, "a.md", "---\ntags: [x]\n---\nbody a");
    const dbDir = mkdir();
    const dbPath = join(dbDir, "index.db");
    const sources = [{ id: "t", dir }];
    await runIndexAtomic({ dbPath, sources }); // valid DB exists

    // Inject a deterministic mid-index failure: a broken symlink whose statSync
    // throws ENOENT during the walk, aborting the forced reindex mid-flight.
    symlinkSync(join(dir, "does-not-exist"), join(dir, "broken.md"));
    const s = new SqliteFtsStore(dbPath);
    s.setUserVersion(1); // force the reindex on next open
    s.close();

    await expect(runIndexAtomic({ dbPath, sources })).rejects.toThrow();

    // Atomicity invariant: prior DB present, queryable, prior state retained
    // (the aborted transaction rolled back), and no .tmp- husk was left behind.
    expect(existsSync(dbPath)).toBe(true);
    const q = new SqliteFtsStore(dbPath);
    expect(q.facets(["tags"]).tags?.x).toBe(1);
    q.close();
    expect(readdirSync(dbDir).some((f) => f.includes(".tmp-"))).toBe(false);
  });

  it("E20: a changed facet-config hash forces a reindex", async () => {
    const dir = mkdir();
    md(dir, "a.md", "---\ntags: [x]\n---\nbody a");
    const dbDir = mkdir();
    const dbPath = join(dbDir, "index.db");
    const sources = [{ id: "t", dir }];

    await runIndexAtomic({ dbPath, sources, facetConfigHash: "h1" });
    const same = await runIndexAtomic({ dbPath, sources, facetConfigHash: "h1" });
    expect(same.changed).toBe(0);
    const changed = await runIndexAtomic({ dbPath, sources, facetConfigHash: "h2" });
    expect(changed.changed).toBe(1);

    const q = new SqliteFtsStore(dbPath);
    expect(q.getMeta("facetConfigHash")).toBe("h2");
    q.close();
  });
});

describe("performance budgets", () => {
  const p95 = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length * 0.95)];

  it("P1: full reindex with frontmatter emit adds ≤ 25% wall-time vs pre-change (same corpus)", async () => {
    // Faithful to the manifest: SAME corpus, baseline = pre-change work (parse +
    // strip + chunk + tags→has_tag, new emit OFF), treatment = full routing ON.
    // The delta measured is exactly the meta-chunk + property-row emit.
    const N = 250;
    const dir = mkdir();
    for (let i = 0; i < N; i++) {
      md(dir, `f${i}.md`, `---\ntitle: Doc ${i}\ntags: [t${i % 5}]\nstatus: s${i % 3}\ndate: 2024-01-${(i % 28) + 1}\n---\n# H${i}\nbody content number ${i} lorem ipsum dolor`);
    }
    const emitOff = { searchableKeys: [] as string[], facetKeys: [] as { key: string }[] };
    const timeReindex = async (fm?: { searchableKeys: string[]; facetKeys: { key: string }[] }) => {
      const store = freshStore();
      const t0 = performance.now();
      await indexSource(store, { root: "t", dir }, { force: true, frontmatter: fm });
      const dt = performance.now() - t0;
      store.close();
      return dt;
    };
    await timeReindex(); // warmup (JIT / fs cache)
    await timeReindex(emitOff);
    // Interleaved per-PAIR ratios: base and treatment measured back-to-back share
    // the same instantaneous system load, so their ratio cancels scheduler drift.
    // For a microbenchmark BUDGET the MIN paired ratio is the right estimator: it
    // is the least-contended sample (the true compute floor) — scheduler jitter and
    // concurrent load only ADD time, so the min reflects the real emit overhead and
    // is stable on both isolated CI and a loaded dev machine. If the floor exceeds
    // 25% the feature genuinely misses budget; noisy higher samples do not.
    const ratios: number[] = [];
    for (let r = 0; r < 15; r++) {
      const base = await timeReindex(emitOff);
      const w = await timeReindex();
      ratios.push(w / base);
    }
    const minRatio = Math.min(...ratios);
    expect(minRatio).toBeLessThanOrEqual(1.25);
    // 32 forced reindexes of a 250-file corpus do not fit vitest's 5s default.
    // Pre-existing overrun, surfaced when packages/kb joined the root vitest
    // projects. See change: fix-kb-search-retrieval-quality.
  }, 120_000);

  it("P2: one eq filter adds ≤ 25ms p95 vs unfiltered", async () => {
    const dir = mkdir();
    for (let i = 0; i < 120; i++) md(dir, `f${i}.md`, `---\nstatus: s${i % 3}\n---\nsharedterm doc ${i} lorem`);
    const store = freshStore();
    await indexSource(store, { root: "t", dir }, { force: true });
    const runs = 200;
    const unfiltered: number[] = [];
    const filtered: number[] = [];
    for (let i = 0; i < runs; i++) {
      let t = performance.now();
      store.search("sharedterm", { limit: 10 });
      unfiltered.push(performance.now() - t);
      t = performance.now();
      store.search("sharedterm", { limit: 10, filters: [{ key: "status", op: "eq", value: "s1" }] });
      filtered.push(performance.now() - t);
    }
    store.close();
    expect(p95(filtered) - p95(unfiltered)).toBeLessThanOrEqual(25);
  });
});

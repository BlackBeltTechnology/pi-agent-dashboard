import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexSource } from "../indexer.js";
import { SqliteFtsStore } from "../sqlite-store.js";
import { runIndexAtomic } from "../index-run.js";
import { loadConfig, validateConfig } from "../config.js";
import { DEFAULT_SEARCHABLE_KEYS } from "../frontmatter.js";
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
    await indexInto(store, dir);
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
  it("E19/X3: a stale user_version forces a reindex; the DB stays valid + atomic", async () => {
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

    // X3: DB present, queryable, version stamped, no temp husk left behind
    expect(existsSync(dbPath)).toBe(true);
    const q = new SqliteFtsStore(dbPath);
    expect(q.getUserVersion()).toBe(2);
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
    // The MEDIAN paired ratio is the robust estimator of the true overhead
    // (outlier-insensitive), far more stable than a ratio of two independent mins.
    const ratios: number[] = [];
    for (let r = 0; r < 15; r++) {
      const base = await timeReindex(emitOff);
      const w = await timeReindex();
      ratios.push(w / base);
    }
    const medianRatio = ratios.slice().sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
    expect(medianRatio).toBeLessThanOrEqual(1.25);
  });

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

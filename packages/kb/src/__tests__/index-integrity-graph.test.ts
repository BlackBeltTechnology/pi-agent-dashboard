// Graph identity / owned-row replacement / index-addressed deletes / cache coherence.
// See change: fix-kb-index-integrity (test-plan E7-E21, E29, P1, P2, X9).
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runIndexAtomic } from "../index-run.js";
import { indexSource } from "../indexer.js";
import { SqliteFtsStore } from "../sqlite-store.js";

// Fault-injection seam over the indexer's fs reads (a real vanished/failing file cannot
// be timed between the walk and the read). Pass-through unless a hook is set.
const hooks: { stat?: (p: string) => void; read?: (p: string) => void } = {};
vi.mock("node:fs", async (orig) => {
  const actual = await orig<typeof import("node:fs")>();
  return {
    ...actual,
    statSync: ((p: unknown, ...a: unknown[]) => {
      hooks.stat?.(String(p));
      return (actual.statSync as (...x: unknown[]) => unknown)(p, ...a);
    }) as typeof actual.statSync,
    readFileSync: ((p: unknown, ...a: unknown[]) => {
      hooks.read?.(String(p));
      return (actual.readFileSync as (...x: unknown[]) => unknown)(p, ...a);
    }) as typeof actual.readFileSync,
  };
});

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kb-integ-"));
  dir = join(root, "docs");
  mkdirSync(dir, { recursive: true });
  hooks.stat = undefined;
  hooks.read = undefined;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const PAD = "Body text comfortably longer than the hundred character minimum so the chunk stays its own chunk in the index. ";
const body = (h: string, extra = "") => `# ${h}\n\n${PAD}${extra}\n`;
function put(rel: string, text: string, bump = 0): void {
  const abs = join(dir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, text);
  if (bump) {
    const t = new Date(Date.now() + bump);
    utimesSync(abs, t, t);
  }
}
let tick = 1000;
const edit = (rel: string, text: string) => put(rel, text, (tick += 5000));
function newStore(path = ":memory:"): SqliteFtsStore {
  const s = new SqliteFtsStore(path);
  s.init();
  return s;
}
const run = (s: SqliteFtsStore, force = false) => indexSource(s, { root: "docs", dir }, { force });

type Row = Record<string, string | number | null>;
const q = (s: SqliteFtsStore, sql: string, ...a: unknown[]): Row[] => s.read((db) => db.prepare(sql).all(...a) as Row[]);
function graphOf(s: SqliteFtsStore) {
  const nodes = q(s, "SELECT type, name, path FROM nodes").map((r) => `${r.type}|${r.name}|${r.path}`).sort();
  const edges = q(s, "SELECT a.name AS s, b.name AS d, e.rel FROM edges e JOIN nodes a ON a.id=e.src JOIN nodes b ON b.id=e.dst").map((r) => `${r.s}|${r.d}|${r.rel}`).sort();
  return { nodes, edges };
}
function contentOf(s: SqliteFtsStore) {
  const chunks = q(s, "SELECT root, path, heading_path, body FROM chunks").map((r) => `${r.root}|${r.path}|${r.heading_path}|${r.body}`).sort();
  const files = q(s, "SELECT root, path FROM files").map((r) => `${r.root}|${r.path}`).sort();
  const props = q(s, "SELECT root, path, key, value FROM properties").map((r) => `${r.root}|${r.path}|${r.key}|${r.value}`).sort();
  return { chunks, files, props, ...graphOf(s) };
}

describe("graph identity (D4)", () => {
  it("E7 same heading text in two files → two qualified nodes, each child_of its own file", async () => {
    put("a.md", body("Why"));
    put("b.md", body("Why"));
    const s = newStore();
    await run(s);
    const g = graphOf(s);
    expect(g.nodes).toContain("heading|a.md#Why|a.md");
    expect(g.nodes).toContain("heading|b.md#Why|b.md");
    expect(g.edges).toContain("a.md#Why|a.md|child_of");
    expect(g.edges).toContain("b.md#Why|b.md|child_of");
    expect(g.nodes.filter((n) => n.startsWith("heading|")).length).toBe(2);
  });

  it("E8 re-chunking one file leaves another file's heading node and edge untouched", async () => {
    put("a.md", body("Why"));
    put("b.md", body("Why"));
    const s = newStore();
    await run(s);
    const before = q(s, "SELECT id FROM nodes WHERE name='b.md#Why'")[0].id;
    const edgeBefore = q(s, "SELECT src, dst FROM edges WHERE src=?", before);
    edit("a.md", body("Why", "edited"));
    expect((await run(s)).changed).toBe(1);
    expect(q(s, "SELECT id FROM nodes WHERE name='b.md#Why'")[0].id).toBe(before);
    expect(q(s, "SELECT src, dst FROM edges WHERE src=?", before)).toEqual(edgeBefore);
  });
});

describe("owned-row replacement (D4)", () => {
  it("E9 inbound edges survive re-chunking the target", async () => {
    put("a.md", `${body("A")}\nSee [b](./b.md)\n`);
    put("b.md", body("B"));
    const s = newStore();
    await run(s);
    edit("b.md", body("B", "edited"));
    await run(s);
    expect(graphOf(s).edges).toContain("a.md|b.md|references");
    expect(s.backlinks("b.md").map((n) => n.name)).toContain("a.md");
  });

  it("E10 outbound edges are replaced", async () => {
    put("a.md", `${body("A")}\nSee [b](./b.md)\n`);
    put("b.md", body("B"));
    put("c.md", body("C"));
    const s = newStore();
    await run(s);
    edit("a.md", `${body("A")}\nSee [c](./c.md)\n`);
    await run(s);
    const e = graphOf(s).edges;
    expect(e).toContain("a.md|c.md|references");
    expect(e).not.toContain("a.md|b.md|references");
  });

  it("E11 a link to a deleted file is kept against a placeholder node", async () => {
    put("a.md", `${body("A")}\nSee [b](./b.md)\n`);
    put("b.md", body("B"));
    const s = newStore();
    await run(s);
    rmSync(join(dir, "b.md"));
    await run(s);
    const g = graphOf(s);
    expect(g.nodes).toContain("file|b.md|null");
    expect(g.edges).toContain("a.md|b.md|references");
  });

  it("E12 unreferenced placeholders and an orphaned tag are swept", async () => {
    put("a.md", `---\ntags: [x]\n---\n${body("A")}`);
    put("b.md", body("B"));
    const s = newStore();
    await run(s);
    expect(graphOf(s).nodes).toContain("tag|tag:x|null");
    s.ensureNode("ghost.md");
    edit("a.md", body("A", "no tag now"));
    await run(s);
    const names = graphOf(s).nodes;
    expect(names.some((n) => n.includes("tag:x"))).toBe(false);
    expect(names.some((n) => n.includes("ghost.md"))).toBe(false);
  });

  it("E13 the graph after 6 incremental steps equals a first index of the final tree", async () => {
    for (let i = 0; i < 20; i++) put(`d${i % 4}/f${i}.md`, `---\ntags: [t${i % 3}]\n---\n${body(`Topic ${i}`)}\n## Sub\n\n${PAD}\nLink [n](../d${(i + 1) % 4}/f${(i + 1) % 20}.md)\n`);
    const inc = newStore();
    await run(inc);
    edit("d0/f0.md", `---\ntags: [t0]\n---\n${body("Topic 0", "edited body")}\n## Sub\n\n${PAD}\n`); // edit body
    await run(inc);
    put("d1/new.md", body("Fresh")); // add file
    await run(inc);
    rmSync(join(dir, "d2/f2.md")); // delete file
    await run(inc);
    edit("d3/f3.md", `---\ntags: [t0]\n---\n${body("Topic 3")}\n## Sub\n\n${PAD}\nLink [n](../d0/f0.md)\n`); // retarget link
    await run(inc);
    edit("d1/f1.md", `---\ntags: [zzz]\n---\n${body("Topic 1")}\n## Sub\n\n${PAD}\n`); // change tag
    await run(inc);
    edit("d0/f4.md", `---\ntags: [t1]\n---\n${body("Renamed heading")}\n## Sub\n\n${PAD}\n`); // rename heading
    await run(inc);
    const first = newStore();
    await run(first);
    expect(graphOf(inc)).toEqual(graphOf(first));
  });

  it("E14 a forced pass equals a first index (files, chunks, properties, nodes, edges)", async () => {
    for (let i = 0; i < 50; i++) put(`g${i % 5}/f${i}.md`, `---\ntags: [t${i % 4}]\n---\n${body(`Topic ${i}`)}\n## Sub\n\n${PAD}\nLink [n](./f${(i + 5) % 50}.md)\n`);
    const file = join(root, "forced.db");
    const s = newStore(file);
    await run(s);
    await run(s, true);
    const first = newStore();
    await run(first);
    expect(contentOf(s)).toEqual(contentOf(first));
    s.close();
  });
});

describe("neighbors resolution (D4)", () => {
  it("E15 exact qualified, bare union, LIKE metachars literal, '#'-arguments never fall back", async () => {
    put("a.md", `${body("Why")}\n## Deep\n\n${PAD}\n`);
    put("b.md", body("Why"));
    put("c.md", body("100%_x"));
    put("d#e.md", body("Why"));
    const s = newStore();
    await run(s);
    const names = (arg: string) => s.neighbors(arg, 3).map((n) => n.name).sort();
    expect(names("a.md#Why")).toEqual(["a.md"]);
    // bare: union over a, b, d#e subtrees; none of the 3 origins in the result
    expect(names("Why")).toEqual(["a.md", "b.md", "d#e.md"]);
    expect(names("100%_x")).toEqual(["c.md"]);
    expect(names("100%_y")).toEqual([]);
    expect(names("zzz#Why")).toEqual([]);
    expect(s.backlinks("Why").map((n) => n.name)).toContain("a.md#Why > Deep");
  });
});

describe("index-addressed per-file replacement (D5)", () => {
  it("E16 deletes exactly the file's chunks (incl. :meta); others' rowids unchanged", async () => {
    put("f1.md", `---\ntitle: One\n---\n${body("One")}`);
    put("f2.md", body("Two"));
    put("f3.md", body("Three"));
    const s = newStore();
    await run(s);
    const ids = (p: string) => q(s, "SELECT rowid FROM chunks WHERE path=? ORDER BY rowid", p).map((r) => r.rowid);
    const before = { f1: ids("f1.md"), f2: ids("f2.md"), f3: ids("f3.md") };
    expect(q(s, "SELECT 1 FROM chunks WHERE path='f1.md' AND chunk_id LIKE '%:meta'").length).toBe(1);
    edit("f1.md", `---\ntitle: One\n---\n${body("One", "rewritten")}`);
    await run(s);
    const after = ids("f1.md");
    expect(after.length).toBe(before.f1.length);
    expect(q(s, "SELECT count(*) n FROM chunks WHERE path='f1.md' AND body LIKE '%rewritten%'")[0].n).toBeGreaterThan(0);
    expect(ids("f2.md")).toEqual(before.f2);
    expect(ids("f3.md")).toEqual(before.f3);
  });

  it("E17 a pre-existing DB without the record is backfilled: no duplicates after a re-chunk", async () => {
    put("a.md", body("A"));
    put("b.md", body("B"));
    const file = join(root, "x.db");
    const s = newStore(file);
    await run(s);
    s.close();
    const raw = newStore(file);
    raw.read((db) => db.exec("DELETE FROM item_rows"));
    raw.close();
    const s2 = newStore(file);
    edit("a.md", body("A", "edited"));
    await run(s2);
    expect(q(s2, "SELECT count(*) n FROM chunks WHERE path='a.md'")[0].n).toBe(q(s2, "SELECT count(*) n FROM item_rows WHERE path='a.md'")[0].n);
    expect(q(s2, "SELECT count(*) n FROM chunks WHERE path='a.md'")[0].n).toBe(1);
    s2.close();
  });

  it("E18 chunks written without the record are re-recorded: no duplicates, no cross-file delete", async () => {
    put("x.md", body("X"));
    put("y.md", body("Y"));
    put("z.md", body("Z"));
    const file = join(root, "x.db");
    const s = newStore(file);
    await run(s);
    s.close();
    // emulate an earlier-release writer: scan-delete X, scan-delete Y and reinsert Y's chunk
    // (reusing freed rowids) with no record rows.
    const old = newStore(file);
    const ychunk = q(old, "SELECT * FROM chunks WHERE path='y.md'")[0];
    old.read((db) => {
      db.exec("DELETE FROM chunks WHERE path='x.md'");
      db.exec("DELETE FROM chunks WHERE path='y.md'");
      db.prepare("INSERT INTO chunks(root,path,chunk_id,doc_type,parent_chunk_id,level,body_hash,heading_path,heading,body,start_line,end_line) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
        ychunk.root, ychunk.path, ychunk.chunk_id, ychunk.doc_type, ychunk.parent_chunk_id, ychunk.level, ychunk.body_hash, ychunk.heading_path, ychunk.heading, ychunk.body, ychunk.start_line, ychunk.end_line,
      );
    });
    old.close();
    const s2 = newStore(file);
    edit("x.md", body("X", "edited"));
    edit("y.md", body("Y", "edited"));
    await run(s2);
    for (const p of ["x.md", "y.md", "z.md"]) expect(q(s2, "SELECT count(*) n FROM chunks WHERE path=?", p)[0].n).toBe(1);
    expect(q(s2, "SELECT count(*) n FROM chunks WHERE path='z.md' AND body LIKE '%edited%'")[0].n).toBe(0);
    s2.close();
  });

  it("E19 legacy (bare) heading names are re-chunked even though the file is unchanged", async () => {
    put("a.md", body("Why"));
    const file = join(root, "x.db");
    const s = newStore(file);
    await run(s);
    s.read((db) => db.exec("UPDATE nodes SET name='Why' WHERE type='heading'"));
    s.close();
    const s2 = newStore(file);
    const st = await run(s2);
    expect(st.changed).toBeGreaterThanOrEqual(1);
    expect(q(s2, "SELECT name FROM nodes WHERE type='heading'").map((r) => r.name)).toEqual(["a.md#Why"]);
    s2.close();
  });

  it("E20 the chunk-rowid record is cleared on a chunks-schema migration", () => {
    const file = join(root, "old.db");
    const s = newStore(file);
    s.read((db) => {
      db.exec("DROP TABLE chunks");
      db.exec("CREATE VIRTUAL TABLE chunks USING fts5(root UNINDEXED, path UNINDEXED, chunk_id UNINDEXED, doc_type UNINDEXED, parent_chunk_id UNINDEXED, level UNINDEXED, body_hash UNINDEXED, heading_path, heading, body, tokenize='porter unicode61')");
      db.exec("INSERT INTO item_rows(root,path,rid) VALUES('docs','a.md',1)");
    });
    s.close();
    const s2 = new SqliteFtsStore(file);
    s2.init(); // migrateChunksSchema
    expect(q(s2, "SELECT count(*) n FROM item_rows")[0].n).toBe(0);
    s2.close();
  });

  it("E21 a file vanishing between the walk and its stat is treated as deleted", async () => {
    for (const n of ["f1", "f2", "f3"]) put(`${n}.md`, body(n));
    const s = newStore();
    await run(s);
    edit("f1.md", body("f1", "e"));
    hooks.stat = (p) => {
      if (p.endsWith("f2.md")) throw Object.assign(new Error("ENOENT: gone"), { code: "ENOENT" });
    };
    const st = await run(s);
    expect(st.deleted).toBe(1);
    expect(q(s, "SELECT count(*) n FROM chunks WHERE path='f2.md'")[0].n).toBe(0);
    expect(q(s, "SELECT count(*) n FROM chunks WHERE path='f3.md'")[0].n).toBe(1);
    expect(q(s, "SELECT count(*) n FROM chunks WHERE path='f1.md'")[0].n).toBe(1);
  });

  it("X9 a forced pass failing part-way leaves no file without rows (committed batches re-chunked, the rest prior)", async () => {
    for (let i = 0; i < 300; i++) put(`f${String(i).padStart(3, "0")}.md`, body(`T${i}`, "v1"));
    const file = join(root, "x.db");
    const s = newStore(file);
    await run(s);
    for (let i = 0; i < 300; i++) put(`f${String(i).padStart(3, "0")}.md`, body(`T${i}`, "v2"));
    let reads = 0;
    hooks.read = (p) => {
      if (p.endsWith(".md") && ++reads === 250) throw new Error("EIO injected");
    };
    await expect(run(s, true)).rejects.toThrow(/EIO/);
    hooks.read = undefined;
    const per = q(s, "SELECT path, count(*) n FROM chunks GROUP BY path");
    expect(per.length).toBe(300);
    expect(per.every((r) => Number(r.n) >= 1)).toBe(true);
    expect(q(s, "SELECT count(DISTINCT path) n FROM chunks WHERE body LIKE '%v2%'")[0].n).toBe(200);
    expect(q(s, "SELECT count(DISTINCT path) n FROM chunks WHERE body LIKE '%v1%'")[0].n).toBe(100);
    s.close();
  });
});

describe("record rebuild robustness (D5)", () => {
  it("X12 a concurrent mapped writer during the rebuild leaves no duplicate chunks", async () => {
    for (let i = 0; i < 30; i++) put(`f${i}.md`, body(`T${i}`));
    const file = join(root, "x.db");
    const first = newStore(file);
    await run(first);
    first.close();
    const w = new SqliteFtsStore(file, { busyTimeoutMs: 0 });
    w.init();
    let i = 0;
    let stop = false;
    const pump = () => {
      if (stop) return;
      try {
        w.insertChunk({ root: "other", path: `w${i}.md`, chunkId: `w${i}`, headingPath: "H", heading: "H", level: 1, parentChunkId: null, docType: "doc", body: `w ${i}`, bodyHash: `w${i}` });
      } catch { /* BUSY while the pass holds its batch transaction — expected */ }
      i++;
      setImmediate(pump);
    };
    pump();
    const p = newStore(file); // new connection: its first pass rebuilds the record
    await run(p, true);
    stop = true;
    expect(q(p, "SELECT path FROM chunks GROUP BY path HAVING count(*) > 1").length).toBe(0);
    expect(q(p, "SELECT count(DISTINCT path) n FROM chunks WHERE root='docs'")[0].n).toBe(30);
    w.close();
    p.close();
  });

  it("X15 rollback then re-upgrade: an earlier-release re-chunk (unrecorded rows, bare headings) heals on the next pass", async () => {
    put("a.md", body("Why"));
    put("b.md", body("Why"));
    const file = join(root, "x.db");
    const s = newStore(file);
    await run(s);
    s.close();
    const old = newStore(file);
    const c = q(old, "SELECT * FROM chunks WHERE path='a.md'")[0];
    old.read((db) => {
      db.exec("DELETE FROM chunks WHERE path='a.md'"); // scan delete
      db.prepare("INSERT INTO chunks(root,path,chunk_id,doc_type,parent_chunk_id,level,body_hash,heading_path,heading,body,start_line,end_line) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
        c.root, c.path, c.chunk_id, c.doc_type, c.parent_chunk_id, c.level, c.body_hash, c.heading_path, c.heading, c.body, c.start_line, c.end_line,
      );
      db.exec("UPDATE nodes SET name='Why' WHERE name='a.md#Why'"); // bare name
    });
    old.close();
    edit("a.md", body("Why", "after rollback"));
    const s2 = newStore(file);
    await run(s2);
    expect(q(s2, "SELECT count(*) n FROM chunks WHERE path='a.md'")[0].n).toBe(1);
    expect(q(s2, "SELECT name FROM nodes WHERE type='heading' AND path='a.md'").map((r) => r.name)).toEqual(["a.md#Why"]);
    s2.close();
  });
});

describe("cached ranking statistics (D3)", () => {
  it("E29 a long-lived store's document frequencies follow another connection's commit", () => {
    const file = join(root, "dfc.db");
    const a = newStore(file);
    const ch = (path: string) => ({ root: "docs", path, chunkId: `${path}:1`, headingPath: "H", heading: "H", level: 1, parentChunkId: null, docType: "doc" as const, body: "zeta zeta body", bodyHash: path });
    a.begin();
    a.insertChunk(ch("seed.md"));
    a.commit();
    expect(a.search("zeta").length).toBe(1);
    const df = () => (a as unknown as { documentFrequencies(t: string[]): Map<string, number> }).documentFrequencies(["zeta"]).get("zeta");
    expect(df()).toBe(1);
    const b = newStore(file);
    b.begin();
    for (let i = 0; i < 5; i++) b.insertChunk(ch(`n${i}.md`));
    b.commit();
    b.close();
    expect(a.search("zeta").length).toBe(6);
    expect(df()).toBe(6);
    a.close();
  });
});

describe("performance (K1)", () => {
  const med = (xs: number[]) => xs.slice().sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  function big(): void {
    for (let i = 0; i < 600; i++) {
      const heads = Array.from({ length: 8 }, (_, h) => `## Section ${h}\n\n${PAD} file ${i} section ${h}\n`).join("\n");
      put(`g${i % 20}/f${i}.md`, `# Doc ${i}\n\n${PAD}\n\n${heads}`);
    }
  }
  it("P1 median forced pass ≤ 1.5 × median first index (600 files × 8 headings)", async () => {
    big();
    const first: number[] = [];
    const forced: number[] = [];
    for (let r = 0; r < 3; r++) {
      const s = newStore();
      let t = performance.now();
      await run(s);
      first.push(performance.now() - t);
      t = performance.now();
      await run(s, true);
      forced.push(performance.now() - t);
      s.close();
    }
    expect(med(forced)).toBeLessThanOrEqual(1.5 * med(first));
  }, 120_000);

  it("P2 re-chunking every file issues no scan-style per-file chunk deletes", async () => {
    big();
    const s = newStore();
    await run(s);
    const seen: string[] = [];
    const db = (s as unknown as { db: { prepare: (sql: string) => unknown } }).db;
    const orig = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      seen.push(sql);
      return orig(sql);
    };
    await run(s, true);
    expect(seen.filter((x) => /DELETE FROM chunks WHERE root=\? AND path=\?/.test(x)).length).toBe(0);
    s.close();
  }, 120_000);
});

describe("pre-existing helpers still behave", () => {
  it("runIndexAtomic first index leaves a queryable db with the qualified heading nodes", async () => {
    put("a.md", body("Why"));
    const dbPath = join(root, "kb/index.db");
    await runIndexAtomic({ dbPath, sources: [{ id: "docs", dir }] });
    expect(existsSync(dbPath)).toBe(true);
    const s = new SqliteFtsStore(dbPath);
    expect(q(s, "SELECT name FROM nodes WHERE type='heading'").map((r) => r.name)).toEqual(["a.md#Why"]);
    s.close();
  });
});

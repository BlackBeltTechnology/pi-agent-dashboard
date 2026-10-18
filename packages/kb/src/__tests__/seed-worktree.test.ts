// Seeded first index in a linked worktree. See change: add-kb-worktree-seed
// (test-plan E1–E6, E9–E13, E16–E19, E21, E22, F1–F3, X5, X6).
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteFtsStore } from "../sqlite-store.js";
import { addWorktree, type Dump, doc, dump, indexAt, KB_CONFIG, mkMain, rowsOfPath, rowsOfRoot, sameRows, setMtime, sh, useSeedTree, writeFile } from "./helpers/seed-fixture.js";

const t = useSeedTree();
const dbOf = (cwd: string) => join(cwd, ".pi/dashboard/kb/index.db");
const refDb = () => join(t.tmp, "ref.db");

/** Index the main checkout, add a worktree. */
async function mainAndWorktree(o: Parameters<typeof mkMain>[1] = {}): Promise<string> {
  mkMain(t, o);
  await indexAt(t.main);
  return addWorktree(t);
}
/** Seeded first index of `wt` + an unseeded reference of the same tree; asserts equality. */
async function seededEqualsReference(wt: string) {
  const seeded = await indexAt(wt);
  await indexAt(wt, { dbPath: refDb(), noSeed: true });
  sameRows(dump(dbOf(wt)), dump(refDb()));
  return seeded;
}
/** E1 mutation: edit 3, add 2, delete 2. */
function mutate(wt: string): void {
  writeFile(wt, "docs/d0.md", doc(0, 30, "edited"));
  writeFile(wt, "docs/d1.md", doc(1, 30, "edited"));
  writeFile(wt, "packages/p2/README.md", doc(2, 30, "pedited"));
  writeFile(wt, "docs/new0.md", doc(100, 30, "new"));
  writeFile(wt, "packages/pnew/README.md", doc(101, 30, "pnew"));
  rmSync(join(wt, "docs/d5.md"));
  rmSync(join(wt, "packages/p6/README.md"));
}
const withMainDb = <T>(fn: (s: SqliteFtsStore) => T): T => {
  const s = new SqliteFtsStore(dbOf(t.main));
  try {
    return fn(s);
  } finally {
    s.close();
  }
};

describe("seeded first index (equality, re-chunk set)", () => {
  it("E1/E2 equals an unseeded first index; only the 5 differing files are re-chunked", async () => {
    const wt = await mainAndWorktree();
    mutate(wt);
    const seeded = await seededEqualsReference(wt);
    expect(seeded.lines).toEqual([`[kb] seed=${t.main} sources=2/2`]);
    expect(seeded.stats.changed).toBe(5);
    expect(seeded.stats.deleted).toBeGreaterThanOrEqual(2);
  });

  it("E3 a file only in the main checkout does not reach the worktree", async () => {
    mkMain(t);
    writeFile(t.main, "docs/notes/private.md", doc(900, 30, "priv"));
    await indexAt(t.main);
    expect(rowsOfPath(dbOf(t.main), "notes/private.md")).toBeGreaterThan(0);
    const wt = addWorktree(t);
    const seeded = await seededEqualsReference(wt);
    expect(seeded.lines[0]).toMatch(/^\[kb\] seed=/);
    expect(seeded.stats.deleted).toBeGreaterThanOrEqual(1);
    expect(rowsOfPath(dbOf(wt), "notes/private.md")).toBe(0);
  });

  it("E4 same mtime, different content is re-chunked from the worktree", async () => {
    const wt = await mainAndWorktree();
    // Pin an exact, representable mtime in main's record so the worktree file can match it bit for bit.
    const mainMtime = 1_700_000_000_000;
    withMainDb((s) => s.setFileState("docs", "d3.md", { ...s.getFileState("docs", "d3.md")!, mtimeMs: mainMtime }));
    writeFile(wt, "docs/d3.md", doc(3, 30, "swapped"));
    setMtime(join(wt, "docs/d3.md"), mainMtime);
    const seeded = await seededEqualsReference(wt);
    expect(seeded.lines[0]).toMatch(/^\[kb\] seed=/);
    expect(seeded.stats.changed).toBe(1);
    const d = dump(dbOf(wt));
    expect(d.chunks.some((c) => c.includes("intro" + "swapped3"))).toBe(true);
    expect(d.chunks.some((c) => c.includes("intro3 "))).toBe(false);
  });

  it("E5 a source with a mismatched record builds from scratch; the other is seeded", async () => {
    mkMain(t);
    await indexAt(t.main);
    withMainDb((s) => s.setMeta("gate:docs", "3:stale"));
    const wt = addWorktree(t);
    writeFile(wt, "packages/p2/README.md", doc(2, 30, "pedited"));
    const seeded = await seededEqualsReference(wt);
    expect(seeded.lines).toEqual([`[kb] seed=${t.main} sources=1/2`]);
    expect(seeded.stats.changed).toBe(30 + 1); // every docs file + the one edited packages file
  });

  it("E6 rows from another kb engine are not kept", async () => {
    mkMain(t);
    await indexAt(t.main);
    withMainDb((s) => s.setMeta("engine:docs", "X"));
    const wt = addWorktree(t);
    const seeded = await seededEqualsReference(wt);
    expect(seeded.lines).toEqual([`[kb] seed=${t.main} sources=1/2`]);
    expect(seeded.stats.changed).toBe(30);
  });
});

describe("sources dropped by acceptance or after the walk", () => {
  const withExtra = { sources: [...KB_CONFIG.sources, { ref: "extra" }], include: ["**/*.md"] };

  it("E9/X5 an unconfigured source's rows are dropped, even from an old-writer map without item_rows", async () => {
    mkMain(t);
    writeFile(t.main, ".pi/dashboard/knowledge_base.json", JSON.stringify(withExtra)); // main only; the worktree keeps the committed config
    writeFile(t.main, "extra/e.md", doc(500, 30, "x"));
    await indexAt(t.main);
    withMainDb((s) => s.read((db) => db.exec("DELETE FROM item_rows")));
    const wt = addWorktree(t);
    const seeded = await seededEqualsReference(wt);
    expect(rowsOfRoot(dbOf(wt), "extra")).toBe(0);
    const meta = dump(dbOf(wt)).meta;
    expect(meta["gate:extra"]).toBeUndefined();
    expect(meta["engine:extra"]).toBeUndefined();
    expect(seeded.lines).toEqual([`[kb] seed=${t.main} sources=2/2`]);
  });

  it("E10/X6 a configured source missing in the worktree is dropped, with its graph nodes", async () => {
    mkMain(t, { config: withExtra });
    writeFile(t.main, "extra/e.md", doc(500, 30, "x"));
    sh(t.main, "add", "-A");
    sh(t.main, "commit", "-q", "-m", "extra");
    await indexAt(t.main);
    const wt = addWorktree(t);
    rmSync(join(wt, "extra"), { recursive: true });
    const seeded = await seededEqualsReference(wt);
    expect(rowsOfRoot(dbOf(wt), "extra")).toBe(0);
    const d = dump(dbOf(wt));
    expect(d.nodes.some((n) => n.includes("e.md"))).toBe(false);
    expect(d.nodes.some((n) => n.endsWith("|null") && n.includes("e.md"))).toBe(false);
    expect(seeded.lines[0]).toBe(`[kb] seed=${t.main} sources=2/3`);
  });

  it("E11 a source the caller does not pass is dropped", async () => {
    mkMain(t, { config: withExtra });
    writeFile(t.main, "extra/e.md", doc(500, 30, "x"));
    sh(t.main, "add", "-A");
    sh(t.main, "commit", "-q", "-m", "extra");
    await indexAt(t.main);
    const wt = addWorktree(t);
    const cfgSources = [{ id: "docs", dir: join(wt, "docs") }, { id: "packages", dir: join(wt, "packages") }];
    const seeded = await indexAt(wt, { extra: { sources: cfgSources } });
    expect(rowsOfRoot(dbOf(wt), "extra")).toBe(0);
    expect(seeded.lines).toEqual([`[kb] seed=${t.main} sources=2/2`]);
  });
});

describe("main-checkout discovery in a first index", () => {
  it("E12 main checkout, non-git dir and bare-repository worktree do not seed", async () => {
    mkMain(t);
    expect((await indexAt(t.main)).lines).toEqual(["[kb] seed-skipped=not-a-worktree"]);

    const plain = join(t.tmp, "plain");
    writeFile(plain, ".pi/dashboard/knowledge_base.json", JSON.stringify(KB_CONFIG));
    writeFile(plain, "docs/a.md", doc(1, 3));
    writeFile(plain, "packages/b.md", doc(2, 3));
    expect((await indexAt(plain)).lines).toEqual(["[kb] seed-skipped=not-a-worktree"]);

    const bare = join(t.tmp, "bare.git");
    sh(t.tmp, "clone", "-q", "--bare", t.main, bare);
    const bw = join(t.tmp, "bw");
    sh(bare, "worktree", "add", "-q", "-b", "bwb", bw, "main");
    expect((await indexAt(bw)).lines).toEqual(["[kb] seed-skipped=no-main-checkout"]);
    // no snapshot temp left anywhere
    for (const d of [t.main, plain, bw]) expect(existsSync(`${dbOf(d)}.tmp-${process.pid}`)).toBe(false);
  });

  it("E13 a worktree of a submodule seeds from the submodule checkout", async () => {
    const sub = join(t.tmp, "subrepo");
    mkdirSync(sub, { recursive: true });
    sh(sub, "init", "-q", "-b", "main");
    writeFile(sub, ".pi/dashboard/knowledge_base.json", JSON.stringify({ sources: [{ ref: "docs" }], include: ["**/*.md"] }));
    writeFile(sub, ".gitignore", ".pi/dashboard/kb/\n");
    for (let i = 0; i < 10; i++) writeFile(sub, `docs/d${i}.md`, doc(i, 10));
    sh(sub, "add", "-A");
    sh(sub, "commit", "-q", "-m", "sub");
    const sup = join(t.tmp, "super");
    mkdirSync(sup, { recursive: true });
    sh(sup, "init", "-q", "-b", "main");
    sh(sup, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "sub");
    sh(sup, "commit", "-q", "-m", "super");
    const checkout = join(sup, "sub");
    await indexAt(checkout);
    const wt = join(t.tmp, "subwt");
    sh(checkout, "worktree", "add", "-q", "-b", "sw", wt);
    writeFile(wt, "docs/d2.md", doc(2, 10, "edited"));
    const seeded = await indexAt(wt);
    expect(seeded.lines).toEqual([`[kb] seed=${checkout} sources=1/1`]);
    await indexAt(wt, { dbPath: refDb(), noSeed: true });
    sameRows(dump(dbOf(wt)), dump(refDb()));
  });
});

describe("opt-out and reasons", () => {
  it("E16 seeding disabled by config, --no-seed and an explicit --source: no snapshot, no staleness copy", async () => {
    mkMain(t);
    writeFile(t.main, ".pi/dashboard/kb/dox-staleness.json", JSON.stringify({ version: 2, files: { "x.md": { sha256: "a" } } }));
    await indexAt(t.main);
    const cases: Array<[string, (wt: string) => Promise<{ lines: string[] }>]> = [
      ["config", async (wt) => {
        writeFile(wt, ".pi/dashboard/knowledge_base.json", JSON.stringify({ ...KB_CONFIG, seedFromMainWorktree: false }));
        return indexAt(wt);
      }],
      ["--no-seed", (wt) => indexAt(wt, { noSeed: true })],
      ["--source", (wt) => indexAt(wt, { explicitSources: true, extra: { explicit: true } })],
    ];
    for (const [i, [, run]] of cases.entries()) {
      const wt = addWorktree(t, `wt${i}`);
      const r = await run(wt);
      expect(r.lines).toEqual(["[kb] seed-skipped=disabled"]);
      expect(existsSync(join(wt, ".pi/dashboard/kb/dox-staleness.json"))).toBe(false);
      expect(dump(dbOf(wt)).meta["engine:docs"]).toBe("E1");
    }
  });

  it("E17 a database path outside the worktree, or --db, is custom-dbpath", async () => {
    mkMain(t);
    await indexAt(t.main);
    const wt = addWorktree(t);
    writeFile(wt, ".pi/dashboard/knowledge_base.json", JSON.stringify({ ...KB_CONFIG, dbPath: join(t.tmp, "outside/index.db") }));
    expect((await indexAt(wt)).lines).toEqual(["[kb] seed-skipped=custom-dbpath"]);
    const wt2 = addWorktree(t, "wt2");
    expect((await indexAt(wt2, { seed: { customDb: true }, dbPath: join(t.tmp, "x.db") })).lines).toEqual(["[kb] seed-skipped=custom-dbpath"]);
  });

  it("E18 main has no index / is building one / holds an empty file", async () => {
    mkMain(t);
    const wt = addWorktree(t, "wtA");
    expect((await indexAt(wt)).lines).toEqual(["[kb] seed-skipped=no-main-index"]);

    // a live foreign first-index marker (the parent process is alive and not us)
    mkdirSync(join(t.main, ".pi/dashboard/kb"), { recursive: true });
    writeFileSync(`${dbOf(t.main)}.tmp-${process.ppid}`, "x");
    const wtB = addWorktree(t, "wtB");
    const b = await indexAt(wtB);
    expect(b.lines).toEqual(["[kb] seed-skipped=main-building"]);
    rmSync(`${dbOf(t.main)}.tmp-${process.ppid}`);

    writeFileSync(dbOf(t.main), "");
    const wtC = addWorktree(t, "wtC");
    const c = await indexAt(wtC);
    expect(c.lines).toEqual(["[kb] seed-skipped=no-main-index"]);
    expect(c.stats.counts.chunks).toBeGreaterThan(0);
  });

  it("E19 reason precedence: disabled › not-a-worktree › … › custom-dbpath", async () => {
    mkMain(t);
    const plain = join(t.tmp, "plain");
    writeFile(plain, ".pi/dashboard/knowledge_base.json", JSON.stringify(KB_CONFIG));
    writeFile(plain, "docs/a.md", doc(1, 3));
    writeFile(plain, "packages/b.md", doc(2, 3));
    expect((await indexAt(plain, { noSeed: true })).lines).toEqual(["[kb] seed-skipped=disabled"]);
    const wt = addWorktree(t); // main has no index
    expect((await indexAt(wt, { seed: { customDb: true } })).lines).toEqual(["[kb] seed-skipped=custom-dbpath"]);
  });
});

describe("DOX acknowledgements", () => {
  const read = (wt: string) => {
    const f = join(wt, ".pi/dashboard/kb/dox-staleness.json");
    return existsSync(f) ? readFileSync(f, "utf8") : null;
  };
  it("E21 copied for the legacy and supported formats only, once, never overwriting", async () => {
    mkMain(t);
    await indexAt(t.main);
    const mainFile = join(t.main, ".pi/dashboard/kb/dox-staleness.json");
    const v2 = JSON.stringify({ version: 2, files: { "a.md": { sha256: "s", size: 1, mtimeMs: 2 } } });
    const legacy = JSON.stringify({ "a.md": "sha-legacy" });
    const rows: Array<[string | null, string | null, string | null]> = [
      [v2, v2, null],
      [legacy, legacy, null],
      [JSON.stringify({ version: 1, files: {} }), null, null],
      ["{ not json", null, null],
      [null, null, null],
      [v2, "PRE-EXISTING", "PRE-EXISTING"],
    ];
    for (const [i, [main, expected, pre]] of rows.entries()) {
      if (main === null) rmSync(mainFile, { force: true });
      else writeFileSync(mainFile, main);
      const wt = addWorktree(t, `wt${i}`);
      if (pre) writeFile(wt, ".pi/dashboard/kb/dox-staleness.json", pre);
      const r = await indexAt(wt);
      expect(r.lines[0]).toMatch(/^\[kb\] seed=/);
      expect(read(wt), `row ${i}`).toBe(expected);
    }
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("E22 an unwritable staleness target never fails the run", async () => {
    mkMain(t, { config: { ...KB_CONFIG, dbPath: "db/index.db" } });
    writeFile(t.main, ".pi/dashboard/kb/dox-staleness.json", JSON.stringify({ version: 2, files: {} }));
    await indexAt(t.main);
    const wt = addWorktree(t);
    const dir = join(wt, ".pi/dashboard/kb");
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o555);
    try {
      const r = await indexAt(wt);
      expect(r.lines).toContain("[kb] seed-staleness-skipped=EACCES");
      expect(r.lines[0]).toMatch(/^\[kb\] seed=/);
    } finally {
      chmodSync(dir, 0o755);
    }
  });
});

describe("snapshot properties", () => {
  const spawnNode = (code: string): ChildProcess =>
    spawn(process.execPath, ["--experimental-sqlite", "-e", code], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, NODE_OPTIONS: "" } });
  const ready = (c: ChildProcess) => new Promise<void>((res, rej) => {
    c.stdout!.on("data", (b) => String(b).includes("READY") && res());
    c.on("exit", (code) => rej(new Error(`child exited ${code} before READY`)));
  });
  const exited = (c: ChildProcess) => new Promise<number | null>((res) => c.on("exit", res));

  it("F1 the main checkout keeps committing while a worktree takes its snapshot; contents unchanged by the run", async () => {
    mkMain(t, { docs: 200, pkgs: 200 });
    await indexAt(t.main);
    const wt = addWorktree(t);
    const writer = `
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(${JSON.stringify(dbOf(t.main))});
      db.exec("PRAGMA busy_timeout=5000");
      const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      console.log("READY");
      for (let i = 0; i < 20; i++) {
        db.exec("BEGIN IMMEDIATE");
        db.prepare("INSERT INTO files(root,path,mtime_ms,sha256) VALUES('w',?,1,'x')").run("w" + i);
        sleep(40);
        db.exec("COMMIT");
        sleep(10);
      }
      db.close();
    `;
    const before = withMainDb((s) => Number((s.read((db) => db.prepare("SELECT COUNT(*) AS n FROM files").get()) as { n: number }).n));
    const child = spawnNode(writer);
    await ready(child);
    const run = indexAt(wt);
    expect(await exited(child)).toBe(0); // no SQLITE_BUSY escaped the writer
    expect((await run).lines[0]).toMatch(/^\[kb\] seed=/);
    const after = withMainDb((s) => Number((s.read((db) => db.prepare("SELECT COUNT(*) AS n FROM files").get()) as { n: number }).n));
    expect(after).toBe(before + 20);
  }, 60_000);

  it("F2 the snapshot includes commits still in the write-ahead log", async () => {
    mkMain(t);
    await indexAt(t.main);
    const wt = addWorktree(t);
    const body = doc(77, 30, "wal");
    writeFile(wt, "docs/walonly.md", body);
    const sha = createHash("sha256").update(body).digest("hex");
    const writer = `
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(${JSON.stringify(dbOf(t.main))});
      db.exec("PRAGMA wal_autocheckpoint=0");
      db.exec("BEGIN");
      db.prepare("INSERT INTO files(root,path,mtime_ms,sha256) VALUES('docs','walonly.md',1,?)").run(${JSON.stringify(sha)});
      for (let i = 0; i < 5; i++) {
        db.prepare("INSERT INTO chunks(root,path,chunk_id,doc_type,parent_chunk_id,level,body_hash,heading_path,heading,body,start_line,end_line) VALUES('docs','walonly.md',?,'doc',NULL,1,'h',?,?,?,NULL,NULL)").run("c" + i, "H" + i, "H" + i, "WALONLYMARKER " + i);
      }
      db.exec("COMMIT");
      console.log("READY");
      process.stdin.resume();
    `;
    const child = spawnNode(writer);
    try {
      await ready(child);
      const r = await indexAt(wt);
      expect(r.lines[0]).toMatch(/^\[kb\] seed=/);
      expect(dump(dbOf(wt)).chunks.filter((c) => c.includes("WALONLYMARKER")).length).toBe(5);
    } finally {
      child.kill("SIGKILL");
    }
  }, 60_000);

  it("F3 the main database contents are not modified by a seeded run", async () => {
    mkMain(t);
    await indexAt(t.main);
    const wt = addWorktree(t);
    mutate(wt);
    const before: Dump = dump(dbOf(t.main));
    await indexAt(wt);
    const after: Dump = dump(dbOf(t.main));
    expect(after).toEqual(before);
  });
});

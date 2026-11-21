// Cancellable indexing + per-batch progress (change: throttle-kb-reindex, D3; test-plan #S25-#S29).
// `IndexOptions.signal` stops the pass at the next file boundary by throwing `KbIndexAborted` (open
// batch rolled back, committed batches kept); `IndexOptions.onProgress` fires once per committed batch.
// A constant fake clock disables the 50 ms time budget so batches are the 100-file count batches only.
// Exemplar: index-atomicity.test.ts (tmp tree + store oracle) / index-batch-budget.test.ts (commit spy).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KbIndexAborted, type IndexOptions, indexSource } from "../indexer.js";
import { SqliteFtsStore } from "../sqlite-store.js";
import { dump, sameRows } from "./helpers/seed-fixture.js";

const BATCH = 100;
let d: string;
beforeEach(() => {
  d = mkdtempSync(join(tmpdir(), "kb-abort-"));
  vi.spyOn(performance, "now").mockReturnValue(0);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(d, { recursive: true, force: true });
});

/** `n` one-chunk files `f0000.md`…; returns the dir. */
function corpus(name: string, n: number): string {
  const dir = join(d, name);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < n; i++) writeFileSync(join(dir, `f${String(i).padStart(4, "0")}.md`), `# Title ${i}\n\nBody ${i} long enough to be a real chunk of content for the index to store.\n`);
  return dir;
}

interface Run {
  dbPath: string;
  commits: number;
  error?: unknown;
}
async function run(name: string, dir: string, opts: Partial<IndexOptions> = {}): Promise<Run> {
  const dbPath = join(d, `${name}.db`);
  const store = new SqliteFtsStore(dbPath);
  store.init();
  let commits = 0;
  const commit = store.commit.bind(store);
  store.commit = () => {
    commits++;
    commit();
  };
  try {
    await indexSource(store, { root: "t", dir }, { cwd: d, force: true, ...opts });
    return { dbPath, commits };
  } catch (error) {
    return { dbPath, commits, error };
  } finally {
    store.close();
  }
}
function rows(dbPath: string): { paths: number; chunks: number } {
  const store = new SqliteFtsStore(dbPath);
  store.init();
  try {
    return { paths: store.listPaths("t").length, chunks: store.counts().chunks };
  } finally {
    store.close();
  }
}

describe("index abort (S25-S27)", () => {
  it("S25 abort inside file k (mid-batch) rejects, rolls back the open batch, keeps committed batches", async () => {
    const dir = corpus("big", 1000);
    const ac = new AbortController();
    let started = 0;
    const r = await run("a", dir, { signal: ac.signal, heartbeat: () => { if (++started === 250) ac.abort(); } });
    expect(r.error).toBeInstanceOf(KbIndexAborted);
    // batches commit at files 101 and 201 → 200 files committed; file 250's batch is rolled back
    expect(rows(r.dbPath)).toEqual({ paths: 2 * BATCH, chunks: 2 * BATCH });
    expect(started).toBe(250); // no file processed after the abort
  });

  it("S26 signal aborted before the call throws at the first boundary with no rows", async () => {
    const dir = corpus("pre", 150);
    const ac = new AbortController();
    ac.abort();
    let started = 0;
    const r = await run("a", dir, { signal: ac.signal, heartbeat: () => { started++; } });
    expect(r.error).toBeInstanceOf(KbIndexAborted);
    expect(rows(r.dbPath)).toEqual({ paths: 0, chunks: 0 });
    expect(started).toBeLessThanOrEqual(1); // no file's work ran
  });

  it("S27 abort from the onProgress of batch 1 keeps batch 1 and commits nothing from batch 2", async () => {
    const dir = corpus("edge", 250);
    const ac = new AbortController();
    const seen: number[] = [];
    const r = await run("a", dir, {
      signal: ac.signal,
      onProgress: (p) => {
        seen.push(p.done);
        ac.abort();
      },
    });
    expect(r.error).toBeInstanceOf(KbIndexAborted);
    expect(seen).toEqual([BATCH]);
    expect(rows(r.dbPath)).toEqual({ paths: BATCH, chunks: BATCH });
  });
});

describe("index progress (S28)", () => {
  it.each([[0], [1], [100], [101], [250]])("fires once per committed batch for %i files", async (n) => {
    const dir = corpus(`p${n}`, n);
    const events: { root: string; done: number; total: number }[] = [];
    const r = await run("a", dir, { onProgress: (p) => events.push({ ...p }) });
    expect(r.error).toBeUndefined();
    if (n === 0) {
      expect(events).toEqual([]);
      return;
    }
    expect(events.length).toBe(Math.ceil(n / BATCH));
    expect(events.map((e) => e.done)).toEqual(Array.from({ length: events.length }, (_, i) => Math.min((i + 1) * BATCH, n)));
    for (const e of events) expect(e).toMatchObject({ root: "t", total: n });
    expect(events.at(-1)?.done).toBe(n);
  });
});

describe("options omitted (S29)", () => {
  it("rows and commit cadence are identical across {neither, signal, onProgress, both}", async () => {
    const dir = corpus("same", 250);
    const base = await run("none", dir);
    const sig = await run("sig", dir, { signal: new AbortController().signal });
    const prog = await run("prog", dir, { onProgress: () => {} });
    const both = await run("both", dir, { signal: new AbortController().signal, onProgress: () => {} });
    for (const r of [base, sig, prog, both]) expect(r.error).toBeUndefined();
    const ref = dump(base.dbPath);
    for (const r of [sig, prog, both]) {
      sameRows(ref, dump(r.dbPath));
      expect(r.commits).toBe(base.commits);
    }
  });
});

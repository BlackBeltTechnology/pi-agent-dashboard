// Time-bounded batch commits (change: throttle-kb-reindex, D2; test-plan #S21-#S24, #S75).
// The batch loop commits + yields at the first of: YIELD_EVERY files OR INDEX_BATCH_MAX_MS since the
// last yield. A fake clock (`vi.spyOn(performance, "now")`) driven from `IndexOptions.heartbeat`
// (called once at the START of each file's work) makes "elapsed" deterministic: a file's cost is
// added at its start, so a check at iteration k+1 sees the cost of files 1..k.
// Exemplar: walk-yield.test.ts (tmp-dir tree + indexSource) / index-atomicity.test.ts (row oracle).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexSource } from "../indexer.js";
import { SqliteFtsStore } from "../sqlite-store.js";
import { measureReindex } from "./helpers/measure-reindex.js";
import { buildReindexCorpus } from "./helpers/reindex-corpus.js";
import { dump, sameRows } from "./helpers/seed-fixture.js";

const BUDGET_MS = 50;
const COUNT = 100;
let d: string;
let clock: number;
beforeEach(() => {
  d = mkdtempSync(join(tmpdir(), "kb-batchbudget-"));
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(d, { recursive: true, force: true });
});

interface Commit {
  /** Files whose work had started when this commit ran (the last one is the final commit). */
  files: number;
  /** Fake-clock time at the commit. */
  t: number;
}
interface PassResult {
  commits: Commit[];
  dbPath: string;
  /** cost charged to each file, in walk order */
  costs: number[];
}

/** One forced pass over `docs`, charging `cost(i)` fake ms at the START of file i (1-based). */
async function pass(name: string, docs: string, cost: (i: number) => number, onCommit?: (store: SqliteFtsStore, c: Commit) => void): Promise<PassResult> {
  const dbPath = join(d, `${name}.db`);
  const store = new SqliteFtsStore(dbPath);
  store.init();
  const commits: Commit[] = [];
  const costs: number[] = [];
  let started = 0;
  const commit = store.commit.bind(store);
  store.commit = () => {
    const c = { files: started, t: clock };
    commits.push(c);
    onCommit?.(store, c);
    commit();
  };
  try {
    clock = 0;
    await indexSource(store, { root: "t", dir: docs }, {
      cwd: d,
      force: true,
      heartbeat: () => {
        started++;
        const c = cost(started);
        costs.push(c);
        clock += c;
      },
    });
  } finally {
    store.close();
  }
  return { commits, dbPath, costs };
}

const BODY = "Body text comfortably longer than the hundred character minimum so the chunk stays its own chunk in the index here.";
function tinyFiles(docs: string, n: number): void {
  mkdirSync(docs, { recursive: true });
  for (let i = 1; i <= n; i++) writeFileSync(join(docs, `f${String(i).padStart(4, "0")}.md`), `# T${i}\n\n${BODY} ${i}\n`);
}

describe("INDEX_BATCH_MAX_MS: files × elapsed decision table (S21)", () => {
  // F files started, then E fake ms elapsed (charged to file F), then one more file. The commit
  // positions (files started at each commit; last = the final commit) are exact, so 50 ms yields, 49 does not.
  const table: Array<[number, number, number[]]> = [
    [99, 49, [100]],
    [99, 50, [99, 100]],
    [99, 51, [99, 100]],
    [100, 49, [100, 101]],
    [100, 50, [100, 101]],
    [100, 51, [100, 101]],
    [101, 49, [100, 102]],
    [101, 50, [100, 101, 102]],
    [101, 51, [100, 101, 102]],
  ];
  it.each(table)("F=%i files, E=%i ms since the last yield → commits at files %j", async (F, E, expected) => {
    const docs = join(d, "docs");
    tinyFiles(docs, F + 1);
    const r = await pass("s21", docs, (i) => (i === F ? E : 0));
    expect(r.commits.map((c) => c.files)).toEqual(expected);
  });
});

describe("one file is the minimum unit (S22)", () => {
  it("a file that costs 60 ms is committed whole; the yield comes after it, never mid-file", async () => {
    const docs = join(d, "docs");
    tinyFiles(docs, 5);
    const seen: Array<{ fileState: unknown; chunkRows: number }> = [];
    const r = await pass("s22", docs, (i) => (i === 1 ? 60 : 0), (store, c) => {
      if (c.files !== 1) return;
      seen.push({
        fileState: store.getFileState("t", "f0001.md"),
        chunkRows: (store.read((db) => db.prepare("SELECT count(*) AS n FROM chunks WHERE path = ?").get("f0001.md")) as { n: number }).n,
      });
    });
    expect(r.commits.map((c) => c.files)).toEqual([1, 5]);
    expect(seen).toHaveLength(1);
    expect(seen[0].fileState).not.toBeNull(); // the file finished (state persisted) before the commit
    expect(seen[0].chunkRows).toBeGreaterThan(0); // and its rows are in the committed batch, intact
  });
});

describe("the budget never changes the rows (S23)", () => {
  it("count-only batching vs a time-yield every ~3 files → identical sorted row sets (files, chunks, graph, properties)", async () => {
    const docs = join(d, "docs");
    buildReindexCorpus(docs, { files: 330, sectionsPerFile: 3 });
    const a = await pass("s23-a", docs, () => 0); // budget disabled: the clock never moves
    const b = await pass("s23-b", docs, () => 20); // 20 ms/file ⇒ a time yield every 3 files
    expect(a.commits.length).toBeLessThanOrEqual(Math.ceil(330 / COUNT) + 1);
    expect(b.commits.length).toBeGreaterThan(80);
    const da = dump(a.dbPath);
    expect(da.files.length).toBeGreaterThanOrEqual(300);
    sameRows(da, dump(b.dbPath));
  });
});

describe("commit cadence on a multi-thousand-file corpus (S24)", () => {
  it("every span between commits ≤ 50 ms + that span's largest file; rows identical to a no-budget pass", async () => {
    const docs = join(d, "docs");
    const { files } = buildReindexCorpus(docs, { files: 2200, sectionsPerFile: 1, ignoredEvery: 0 });
    expect(files).toBeGreaterThanOrEqual(2000);
    const cost = (i: number) => (i % 20 === 0 ? 30 : 2); // uniform 2 ms + 5 % outliers at 30 ms
    const r = await pass("s24-on", docs, cost);
    let prevT = 0;
    let prevFiles = 0;
    for (const c of r.commits) {
      const span = c.t - prevT;
      const largest = Math.max(0, ...r.costs.slice(prevFiles, c.files));
      expect(span, `span ending at file ${c.files}`).toBeLessThanOrEqual(BUDGET_MS + largest);
      prevT = c.t;
      prevFiles = c.files;
    }
    expect(r.commits.length).toBeGreaterThan(files / COUNT); // the time bound did the cutting
    const off = await pass("s24-off", docs, () => 0);
    sameRows(dump(off.dbPath), dump(r.dbPath));
  });
});

// Opt-in (KB_MEASURE=1; ~minutes): budget on vs off over the full 3000-file corpus.
describe.skipIf(!process.env.KB_MEASURE)("throughput guard (S75, KB_MEASURE only)", () => {
  it("wall regression of the 50 ms budget ≤ 15 % vs count-only batching (else raise INDEX_BATCH_MAX_MS)", async () => {
    vi.restoreAllMocks(); // real clock for "on"
    const files = Number(process.env.KB_MEASURE_FILES ?? 3250);
    const stub = vi.spyOn(performance, "now").mockReturnValue(0); // budget OFF: elapsed is always 0
    const off = await measureReindex({ files });
    stub.mockRestore();
    const on = await measureReindex({ files });
    console.log(`KB_MEASURE budget-off ${JSON.stringify(off)}\nKB_MEASURE budget-on ${JSON.stringify(on)}`);
    expect(on.wallMs).toBeLessThanOrEqual(off.wallMs * 1.15);
  }, 1_800_000);
});

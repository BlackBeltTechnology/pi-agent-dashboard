// Child process for proximity-perf.test.ts (change: bound-kb-proximity-search,
// test-plan #P1–#P3, #F1). Run via `node --import tsx`; the parent kills it after
// a hard cap, so a pre-fix exponential proximity search fails the test instead
// of hanging the runner. argv: <mode: delta|search|pool>. Prints one JSON line.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexSource } from "../../indexer.js";
import { proximityDelta, SqliteFtsStore } from "../../sqlite-store.js";
import { withEventLoopLag } from "./event-loop-lag.js";

const mode = process.argv[2];
const terms = (k: number) => Array.from({ length: k }, (_, i) => `term${i}`);
/** Every query term repeated `r` times, interleaved round-robin (span k−1). */
const body = (k: number, r: number) => Array.from({ length: r }, () => terms(k).join(" ")).join(" ");
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
function time<T>(fn: () => T): { ms: number; value: T } {
  const ms: number[] = [];
  let value!: T;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    value = fn();
    ms.push(performance.now() - t0);
  }
  return { ms: median(ms), value };
}

let warns = 0;
const realWarn = console.warn;
console.warn = (...a: unknown[]) => { warns++; realWarn(...a); };

const out: Record<string, unknown> = {};
const dir = mkdtempSync(join(tmpdir(), "kb-prox-perf-"));
try {
  if (mode === "delta") {
    for (const [k, r] of [[10, 100], [6, 50], [8, 100]]) out[`${k}x${r}`] = time(() => proximityDelta(terms(k), body(k, r)));
  } else if (mode === "search") {
    const k = 10;
    const small = body(k, 100);
    // The P1 body padded with non-query prose to ≈450 KB — the field shape
    // (#1075: ~1.6k query-term hits in a 330–450 KB AGENTS.md chunk). Making
    // every token a query term instead would time FTS5 snippet(), which is
    // quadratic in hits per chunk and out of this change's scope.
    const pad = "plain filler prose without any query words ";
    const big = `${small} ${pad.repeat(Math.ceil((450_000 - small.length) / pad.length))}`;
    writeFileSync(join(dir, "small.md"), `# Small\n\n${small}\n`);
    writeFileSync(join(dir, "big.md"), `# Big\n\n${big}\n`);
    const store = new SqliteFtsStore(join(dir, ".kb.db"));
    store.init();
    await indexSource(store, { root: "t", dir });
    const q = terms(k).join(" ");
    const opts = { limit: 10, proximityBoost: true };
    const timed = time(() => store.search(q, opts));
    const plain = store.search(q, { limit: 10, proximityBoost: false });
    const boost = Object.fromEntries(timed.value.map((h) => [h.path, h.score - plain.find((p) => p.chunkId === h.chunkId)!.score]));
    // The delay monitor only records a block spanned by timer turns on BOTH
    // sides (measured: without them a 500 ms block reads 0), so yield one turn
    // before and one after the synchronous search.
    const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 15));
    let searchMs = 0;
    const lag = await withEventLoopLag(async () => {
      await turn();
      const t0 = performance.now();
      const res = store.search(q, opts);
      searchMs = performance.now() - t0;
      await turn();
      return res;
    });
    out.search = { ms: timed.ms, paths: timed.value.map((h) => h.path), boost, bigChars: big.length, maxDelayMs: lag.maxDelayMs, elapsedMs: searchMs };
    store.close();
  } else if (mode === "pool") {
    const k = 6;
    const filler = "lorem ipsum dolor sit amet consectetur adipiscing elit ";
    for (let i = 0; i < 600; i++) {
      const core = body(k, 20);
      writeFileSync(join(dir, `d${i}.md`), `# D${i}\n\nuniq${i} ${core} ${filler.repeat(Math.ceil((5000 - core.length) / filler.length))}\n`);
    }
    const store = new SqliteFtsStore(join(dir, ".kb.db"));
    store.init();
    await indexSource(store, { root: "t", dir });
    const q = terms(k).join(" ");
    const timed = time(() => store.search(q, { limit: 10, proximityBoost: true }));
    out.pool = { ms: timed.ms, hits: timed.value.length };
    store.close();
  }
  out.warns = warns;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(out)}\n`);

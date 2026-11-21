// Forced in-process `indexSource` measurement over the 1.1 corpus (change:
// throttle-kb-reindex, tasks 1.1/1.2/3.7). Reports main-thread event-loop delay
// (perf_hooks histogram), wall time, commit count, files and chunks. Wall time uses
// `process.hrtime` (not `performance.now`) so tests may stub the latter.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { indexSource } from "../../indexer.js";
import { SqliteFtsStore } from "../../sqlite-store.js";
import { buildReindexCorpus, type CorpusOptions } from "./reindex-corpus.js";

export interface ReindexMeasurement {
  files: number;
  chunks: number;
  commits: number;
  wallMs: number;
  maxLagMs: number;
  p99LagMs: number;
}

/** Builds the corpus in a tmp dir, then times ONE forced pass over it. */
export async function measureReindex(corpus: CorpusOptions = {}): Promise<ReindexMeasurement> {
  const d = mkdtempSync(join(tmpdir(), "kb-measure-"));
  const docs = join(d, "docs");
  const store = new SqliteFtsStore(join(d, ".kb.db"));
  try {
    buildReindexCorpus(docs, corpus);
    store.init();
    let commits = 0;
    const commit = store.commit.bind(store);
    store.commit = () => {
      commits++;
      commit();
    };
    const h = monitorEventLoopDelay({ resolution: 10 });
    h.enable();
    const t0 = process.hrtime.bigint();
    try {
      const stats = await indexSource(store, { root: "t", dir: docs }, { cwd: d, force: true });
      const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
      return { files: stats.changed, chunks: stats.chunks, commits, wallMs, maxLagMs: h.max / 1e6, p99LagMs: h.percentile(99) / 1e6 };
    } finally {
      h.disable();
    }
  } finally {
    store.close();
    rmSync(d, { recursive: true, force: true });
  }
}

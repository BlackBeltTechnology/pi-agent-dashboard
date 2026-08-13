// Retrieval-quality evaluation (design §6c Tier E, research §2.5).
// Scores search against a golden `query -> expected path-substring` set.
// Gate ranking changes on these metrics; track normal + paraphrase sets.
import type { KbStore, SearchOpts } from "./types.js";

export interface GoldenItem {
  q: string;
  expect: string; // path substring the correct result should match (root-agnostic)
}
export interface EvalMetrics {
  n: number;
  "P@1": number;
  "P@5": number;
  "Recall@K": number;
  MRR: number;
  "nDCG@K": number;
  /** Mean count of distinct `(root, path)` sources per top-K page (D8). */
  distinctSourcesAtK: number;
  /** Mean fraction of slots whose source already appeared earlier on the page. */
  duplicateSlotShare: number;
  /** Fraction of queries whose whole top-K page comes from one source. */
  singleSourcePageRate: number;
  avgLatencyMs: number;
}

export function evaluate(store: KbStore, golden: GoldenItem[], opts: SearchOpts & { k?: number } = {}): EvalMetrics {
  const k = opts.k ?? 10;
  let p1 = 0, p5 = 0, recall = 0, mrr = 0, ndcg = 0, lat = 0;
  // Redundancy accumulators (D8). Precision/recall are blind to page composition
  // by construction, so redundancy is tracked as its own first-class metric.
  let distinct = 0, dupShare = 0, singleSource = 0, pages = 0;
  for (const g of golden) {
    const t = performance.now();
    const res = store.search(g.q, { ...opts, limit: k });
    lat += performance.now() - t;
    let first = 0;
    res.forEach((r, i) => {
      if (!first && r.path.includes(g.expect)) first = i + 1;
    });
    if (first === 1) p1++;
    if (first >= 1 && first <= 5) p5++;
    if (first >= 1) {
      recall++;
      mrr += 1 / first;
      ndcg += 1 / Math.log2(first + 1); // IDCG=1 (single relevant target)
    }
    if (res.length) {
      const sources = new Set(res.map((r) => `${r.root}\u001f${r.path}`));
      distinct += sources.size;
      dupShare += (res.length - sources.size) / res.length;
      if (sources.size === 1) singleSource++;
      pages++;
    }
  }
  const n = golden.length || 1;
  return {
    n: golden.length,
    "P@1": +(p1 / n).toFixed(3),
    "P@5": +(p5 / n).toFixed(3),
    "Recall@K": +(recall / n).toFixed(3),
    MRR: +(mrr / n).toFixed(3),
    "nDCG@K": +(ndcg / n).toFixed(3),
    distinctSourcesAtK: +(distinct / (pages || 1)).toFixed(3),
    duplicateSlotShare: +(dupShare / (pages || 1)).toFixed(3),
    singleSourcePageRate: +(singleSource / (pages || 1)).toFixed(3),
    avgLatencyMs: +(lat / n).toFixed(2),
  };
}

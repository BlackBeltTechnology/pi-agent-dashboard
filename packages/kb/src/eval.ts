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
  avgLatencyMs: number;
}

export function evaluate(store: KbStore, golden: GoldenItem[], opts: SearchOpts & { k?: number } = {}): EvalMetrics {
  const k = opts.k ?? 10;
  let p1 = 0, p5 = 0, recall = 0, mrr = 0, ndcg = 0, lat = 0;
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
  }
  const n = golden.length || 1;
  return {
    n: golden.length,
    "P@1": +(p1 / n).toFixed(3),
    "P@5": +(p5 / n).toFixed(3),
    "Recall@K": +(recall / n).toFixed(3),
    MRR: +(mrr / n).toFixed(3),
    "nDCG@K": +(ndcg / n).toFixed(3),
    avgLatencyMs: +(lat / n).toFixed(2),
  };
}

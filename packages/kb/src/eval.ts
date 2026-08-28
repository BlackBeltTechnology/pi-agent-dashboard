// Retrieval-quality evaluation (design §6c Tier E, research §2.5).
// Scores search against a golden `query -> expected path-substring` set.
// Gate ranking changes on these metrics; track normal + paraphrase sets.
//
// change fix-kb-eval-measurement-integrity: loadGolden fixture contract (D3),
// two-tier expect normalization + filesystem-anchored reachability (D4).
import { existsSync, readdirSync } from "node:fs";
import type { KbStore, SearchOpts } from "./types.js";

export interface GoldenItem {
  q: string;
  expect: string; // path substring the correct result should match (root-agnostic)
}

/** A configured root, for expect normalization + reachability (design D4).
 *  `relPrefix` is the source dir relative to cwd; `dir` (absolute) is used only
 *  to resolve the root's top-level entries for the reachability rule (b). */
export interface RootRef {
  id: string;
  relPrefix: string;
  dir?: string;
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
  /** Items whose `expect` sits outside every configured root — reported, never
   *  searched, excluded from every metric above (design D4). `n + unreachable`
   *  always sums to the fixture size. */
  unreachable: number;
  /** The unreachable expect paths, only when the caller passes `verbose`. */
  unreachablePaths?: string[];
}

const MSG_SHAPES = `a bare array of {q, expect} items or an object with an "items" array`;

/** Load + validate a golden fixture (design D3). Accepts a bare array or an
 *  object with an `items` array (the mined sets' bundled shape); anything else
 *  throws naming BOTH accepted shapes + the file. Every item must carry a
 *  string `q` and a string `expect` — today a non-string expect is a SILENT
 *  zero (`includes(undefined)`); rejected items name file + array index.
 *  Provenance (`intent`/`minedAt` on the object shape) prints a stderr header
 *  and never affects scoring; stdout stays byte-clean for `--json` pipes. */
export function loadGolden(raw: unknown, file: string): GoldenItem[] {
  const isObj = raw !== null && typeof raw === "object" && !Array.isArray(raw);
  const items = Array.isArray(raw) ? raw : isObj && Array.isArray((raw as { items?: unknown }).items) ? ((raw as { items: unknown[] }).items) : undefined;
  if (!items) throw new Error(`golden fixture must be ${MSG_SHAPES} — got neither in ${file}`);
  const out = items.map((it, i) => {
    if (it === null || typeof it !== "object" || typeof (it as GoldenItem).q !== "string" || typeof (it as GoldenItem).expect !== "string") {
      throw new Error(`${file}: golden item [${i}] must be an object with string "q" and string "expect"`);
    }
    return { q: (it as GoldenItem).q, expect: (it as GoldenItem).expect };
  });
  const p = isObj ? (raw as { intent?: unknown; minedAt?: unknown }) : undefined;
  if (p && (p.intent !== undefined || p.minedAt !== undefined)) {
    console.error(`[kb eval] golden set ${file}: intent=${JSON.stringify(p.intent ?? null)} minedAt=${JSON.stringify(p.minedAt ?? null)} n=${out.length}`);
  }
  return out;
}

/** Normalize a relPrefix: forward slashes, no trailing separator, no "./". */
function normPrefix(p: string): string {
  return (p ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function hasSep(expect: string): boolean {
  return expect.includes("/") || expect.includes("\\");
}
function firstSeg(expect: string): string {
  return normPrefix(expect).split("/")[0];
}

export function evaluate(store: KbStore, golden: GoldenItem[], opts: SearchOpts & { k?: number; roots?: RootRef[]; verbose?: boolean } = {}): EvalMetrics {
  const { k = 10, roots, verbose, ...search } = opts;
  // --- Reachability scaffolding (design D4, filesystem-anchored). ---
  const firstSegs = new Set<string>(); // (a) first segments of configured root prefixes
  const topSegs = new Set<string>(); // (b) top-level entries of the configured root dirs
  for (const r of roots ?? []) {
    // An empty-relPrefix root (root === cwd) has NO first segment to contribute
    // to rule (a); it still contributes its top-level entries to rule (b). Only
    // named roots can satisfy rule (a) — an item under a named root is inside
    // the configured roots and must never be marked unreachable (spec R3).
    if (r.dir && existsSync(r.dir)) {
      try {
        for (const e of readdirSync(r.dir)) topSegs.add(e);
      } catch {
        // unreadable root dir → rule (b) contributes nothing for it
      }
    }
    const rel = normPrefix(r.relPrefix);
    if (rel) firstSegs.add(rel.split("/")[0]);
  }
  const isUnreachable = (expect: string): boolean => {
    if (!hasSep(expect)) return false; // bare basename → reachable attempt
    const seg = firstSeg(expect);
    if (firstSegs.has(seg)) return false; // rule (a)
    return !topSegs.has(seg); // rule (b): first segment is a top-level entry of some root dir
  };
  // --- Candidate generation: longest separator-checked prefix strip. ---
  const prefixes = (roots ?? []).map((r) => normPrefix(r.relPrefix)).filter((p) => p.length > 0).sort((a, b) => b.length - a.length);
  const candidates = (expect: string): string[] => {
    for (const p of prefixes) {
      if (expect.startsWith(p + "/") || expect.startsWith(p + "\\")) return [expect.slice(p.length + 1), expect];
    }
    return [expect]; // raw expect always kept as a second candidate
  };

  let p1 = 0, p5 = 0, recall = 0, mrr = 0, ndcg = 0, lat = 0, searched = 0;
  // Redundancy accumulators (D8). Precision/recall are blind to page composition
  // by construction, so redundancy is tracked as its own first-class metric.
  let distinct = 0, dupShare = 0, singleSource = 0, pages = 0;
  const unreachablePaths: string[] = [];
  for (const g of golden) {
    // Unreachable items are decided BEFORE retrieval: no search call, no
    // latency, no contribution to any rank/redundancy/latency metric (D4).
    if (isUnreachable(g.expect)) {
      unreachablePaths.push(g.expect);
      continue;
    }
    const cands = candidates(g.expect);
    const t = performance.now();
    const res = store.search(g.q, { ...search, limit: k });
    lat += performance.now() - t;
    searched++;
    let first = 0;
    res.forEach((r, i) => {
      if (!first && cands.some((c) => r.path.includes(c))) first = i + 1;
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
  const n = searched; // golden.length - unreachable; may be 0 → all metrics 0
  const m: EvalMetrics = {
    n,
    "P@1": +(p1 / (n || 1)).toFixed(3),
    "P@5": +(p5 / (n || 1)).toFixed(3),
    "Recall@K": +(recall / (n || 1)).toFixed(3),
    MRR: +(mrr / (n || 1)).toFixed(3),
    "nDCG@K": +(ndcg / (n || 1)).toFixed(3),
    distinctSourcesAtK: +(distinct / (pages || 1)).toFixed(3),
    duplicateSlotShare: +(dupShare / (pages || 1)).toFixed(3),
    singleSourcePageRate: +(singleSource / (pages || 1)).toFixed(3),
    avgLatencyMs: +(lat / (n || 1)).toFixed(2),
    unreachable: unreachablePaths.length,
  };
  if (verbose) m.unreachablePaths = [...unreachablePaths];
  return m;
}

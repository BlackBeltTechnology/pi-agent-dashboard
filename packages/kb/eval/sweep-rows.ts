// Paired-fixture reporting for the lane-composition sweep (design D6,
// change fix-kb-search-lane-composition).
//
// The two lanes trade off against each other, so a row reporting ONE fixture is
// not evidence for a default — it is the exact shape that hides a regression.
// This module builds a row that carries both metric groups side by side and
// refuses to build one that does not. Extracted from `run-fixtures.ts` so the
// invariant is assertable in-process (the script indexes the whole repo on
// import and can never be unit-tested).
import type { EvalMetrics } from "../src/eval.js";

/** The fixtures every sweep row must carry. */
export const PAIRED_SETS = ["source-intent", "markdown-intent"] as const;
export type PairedSet = (typeof PAIRED_SETS)[number];

/** Metrics projected into a row, per fixture. */
const REPORTED = ["n", "P@1", "P@5", "Recall@K", "MRR", "nDCG@K", "avgLatencyMs"] as const;

/** Build one sweep row carrying BOTH fixtures' metric groups.
 *  Throws when a fixture is absent or scored zero items — a missing or empty
 *  group is a harness error, never a silent cell. */
export function buildPairedRow(variant: string, bySet: Map<string, EvalMetrics>): Record<string, unknown> {
  const row: Record<string, unknown> = { variant };
  for (const set of PAIRED_SETS) {
    const m = bySet.get(set);
    if (!m) throw new Error(`sweep row "${variant}": the ${set} fixture is missing — a row must report BOTH golden sets (design D6)`);
    if (m.n === 0) throw new Error(`sweep row "${variant}": the ${set} fixture scored 0 items — harness misconfiguration, not a measurement`);
    for (const k of REPORTED) row[`${set} ${k === "Recall@K" ? "R@10" : k}`] = m[k];
  }
  return row;
}

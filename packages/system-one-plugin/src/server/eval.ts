/**
 * Per-consumer Test (spec: system-one-settings-ui, "Per-consumer Test"). Runs
 * fixtures against ONE backend through `predict({ onlyBackend })`, at most 500
 * cases, stopping on abort. Reports per-question accuracy, AUC for `noul`
 * with binary `expected`, latency p50/p90, input chars and estimated cost.
 * Thresholds (design D13): per binary `noul` question, the cut maximising
 * accuracy on the fixtures, ties → closest to 0.5; none for `choice`/`score`.
 * See change: add-system-one-registry.
 */
import { type ConsumerDeclaration, type LlmCaller, type PredictResult, predict } from "@blackbelt-technology/pi-system-one";
import type { Fixture } from "./consumers.js";

const MAX_CASES = 500;

interface QuestionReport {
  type: string;
  cases: number;
  correct: number;
  accuracy: number;
  auc: number | null;
  threshold: number | null;
}

export interface EvalReport {
  backendId: string;
  consumerId: string;
  model: string | null;
  cases: number;
  failures: number;
  cancelled: boolean;
  questions: Record<string, QuestionReport>;
  latencyMs: { p50: number | null; p90: number | null };
  inputChars: number;
  estimatedCostUsd: number | null;
  thresholds: Record<string, number>;
}

const asBinary = (v: unknown): boolean | null =>
  v === true || v === 1 ? true : v === false || v === 0 ? false : null;

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/** Mann–Whitney AUC; null without both classes. */
function auc(pairs: Array<{ score: number; label: boolean }>): number | null {
  const pos = pairs.filter((p) => p.label).map((p) => p.score);
  const neg = pairs.filter((p) => !p.label).map((p) => p.score);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

/** Cut maximising accuracy of `score >= cut ⇒ true`; ties → closest to 0.5. */
function bestThreshold(pairs: Array<{ score: number; label: boolean }>): number | null {
  if (!pairs.length) return null;
  const cuts = [...new Set([0.5, ...pairs.map((p) => p.score)])].sort((a, b) => a - b);
  let best = 0.5;
  let bestAcc = -1;
  for (const cut of cuts) {
    const acc = pairs.filter((p) => p.score >= cut === p.label).length / pairs.length;
    if (acc > bestAcc || (acc === bestAcc && Math.abs(cut - 0.5) < Math.abs(best - 0.5))) {
      best = cut;
      bestAcc = acc;
    }
  }
  return best;
}

export interface RunEvalOptions {
  /** The consumer's real declaration: predict re-registers it, so it must not be altered. */
  consumer: ConsumerDeclaration;
  backendId: string;
  cases: Fixture[];
  priceUsdPerMTok?: number;
  llmCaller?: LlmCaller;
  signal?: AbortSignal;
}

interface QuestionTally {
  type: string;
  cases: number;
  correct: number;
  pairs: Array<{ score: number; label: boolean }>;
}
type AnswerLike = { choice?: string; score?: number; noul?: number } | undefined;

/** 1 when `a` matches the expected value for this question type, else 0. Binary noul also records its pair. */
function scoreAnswer(t: QuestionTally, type: string, a: AnswerLike, exp: unknown): number {
  if (type === "choice") return a?.choice === exp ? 1 : 0;
  if (type === "score") return typeof a?.score === "number" && Math.round(a.score) === exp ? 1 : 0;
  const label = asBinary(exp);
  if (label === null || typeof a?.noul !== "number") return 0;
  t.pairs.push({ score: a.noul, label });
  return a.noul >= 0.5 === label ? 1 : 0;
}

/** Fold one case's result into the per-question tallies. */
function tally(perQ: Map<string, QuestionTally>, c: Fixture, r: PredictResult): void {
  for (const [qid, q] of Object.entries(c.questions)) {
    const t = perQ.get(qid) ?? { type: String(q.type), cases: 0, correct: 0, pairs: [] };
    perQ.set(qid, t);
    if (!Object.hasOwn(c.expected, qid)) continue;
    t.cases++;
    if (r.ok) t.correct += scoreAnswer(t, t.type, r.answers[qid] as AnswerLike, c.expected[qid]);
  }
}

function summarize(perQ: Map<string, QuestionTally>): { questions: Record<string, QuestionReport>; thresholds: Record<string, number> } {
  const questions: Record<string, QuestionReport> = {};
  const thresholds: Record<string, number> = {};
  for (const [qid, t] of perQ) {
    const threshold = t.type === "noul" ? bestThreshold(t.pairs) : null;
    if (threshold !== null) thresholds[qid] = threshold;
    questions[qid] = {
      type: t.type,
      cases: t.cases,
      correct: t.correct,
      accuracy: t.cases ? t.correct / t.cases : 0,
      auc: t.type === "noul" ? auc(t.pairs) : null,
      threshold,
    };
  }
  return { questions, thresholds };
}

export async function runEval(o: RunEvalOptions): Promise<EvalReport> {
  const cases = o.cases.slice(0, MAX_CASES);
  const perQ = new Map<string, QuestionTally>();
  const latencies: number[] = [];
  let failures = 0;
  let inputChars = 0;
  let model: string | null = null;
  let done = 0;
  for (const c of cases) {
    if (o.signal?.aborted) break;
    inputChars += c.state.length + JSON.stringify(c.questions).length;
    const r = await predict({ consumer: o.consumer, state: c.state, questions: c.questions, onlyBackend: o.backendId, llmCaller: o.llmCaller, signal: o.signal });
    done++;
    tally(perQ, c, r);
    if (r.ok) {
      model = r.model;
      latencies.push(r.attempts[r.attempts.length - 1].latencyMs);
    } else failures++;
  }
  latencies.sort((a, b) => a - b);
  const { questions, thresholds } = summarize(perQ);
  return {
    backendId: o.backendId,
    consumerId: o.consumer.id,
    model,
    cases: done,
    failures,
    cancelled: done < cases.length,
    questions,
    latencyMs: { p50: percentile(latencies, 0.5), p90: percentile(latencies, 0.9) },
    inputChars,
    estimatedCostUsd: o.priceUsdPerMTok !== undefined ? (o.priceUsdPerMTok * inputChars) / 4 / 1e6 : null,
    thresholds,
  };
}

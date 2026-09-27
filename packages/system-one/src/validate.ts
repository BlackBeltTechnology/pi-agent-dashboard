/**
 * Response validation + normalization. Every requested question must have an
 * answer constrained to its options; anything else makes the whole response
 * invalid (`null`), which the adapter records as `error` for that backend.
 * Missing `probabilities` → the picked option gets 1.0; missing `confidence`
 * → the picked option's probability. See change: add-system-one-registry.
 */
import type { Answer, Answers, ChoiceQuestion, Question, Questions, ScoreQuestion } from "./types.js";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === "object" && !Array.isArray(v);
const prob = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/** Probabilities over exactly the declared keys (absent keys → 0), or null. */
function choiceProbs(keys: string[], picked: string, raw: unknown): Record<string, number> | null {
  if (raw === undefined) return Object.fromEntries(keys.map((k) => [k, k === picked ? 1 : 0]));
  if (!isRec(raw) || Object.keys(raw).some((k) => !keys.includes(k))) return null;
  const out: Record<string, number> = {};
  for (const k of keys) {
    const p = Object.hasOwn(raw, k) ? raw[k] : 0;
    if (!prob(p)) return null;
    out[k] = p;
  }
  return out;
}

function normChoice(q: ChoiceQuestion, a: Rec): Answer | null {
  const keys = Object.keys(q.criteria);
  if (typeof a.choice !== "string" || !keys.includes(a.choice)) return null;
  const probabilities = choiceProbs(keys, a.choice, a.probabilities);
  if (!probabilities) return null;
  const confidence = a.confidence === undefined ? probabilities[a.choice] : a.confidence;
  return prob(confidence) ? { choice: a.choice, probabilities, confidence } : null;
}

function scoreProbs(levels: number, picked: number, raw: unknown): number[] | null {
  if (raw === undefined) return Array.from({ length: levels }, (_, i) => (i === picked ? 1 : 0));
  return Array.isArray(raw) && raw.length === levels && raw.every(prob) ? [...raw] : null;
}

function normScore(q: ScoreQuestion, a: Rec): Answer | null {
  const s = a.score;
  if (typeof s !== "number" || !Number.isFinite(s) || s < 0 || s > q.criteria.length - 1) return null;
  const probabilities = scoreProbs(q.criteria.length, Math.round(s), a.probabilities);
  if (!probabilities) return null;
  const confidence = a.confidence === undefined ? probabilities[Math.round(s)] : a.confidence;
  return prob(confidence) ? { score: s, probabilities, confidence } : null;
}

function normOne(q: Question, a: Rec): Answer | null {
  if (q.type === "choice") return normChoice(q, a);
  if (q.type === "score") return normScore(q, a);
  return prob(a.noul) ? { noul: a.noul } : null;
}

export function normalizeAnswers(questions: Questions, raw: unknown): Answers | null {
  if (!isRec(raw)) return null;
  const out: Answers = {};
  for (const [id, q] of Object.entries(questions)) {
    const a = Object.hasOwn(raw, id) ? raw[id] : undefined;
    const ans = isRec(a) ? normOne(q, a) : null;
    if (!ans) return null;
    out[id] = ans;
  }
  return out;
}

/**
 * Response validation + normalization. Every requested question must have an
 * answer constrained to its options; anything else makes the whole response
 * invalid (`null`), which the adapter records as `error` for that backend.
 * Missing `probabilities` → the picked option gets 1.0; missing `confidence`
 * → the picked option's probability. See change: add-system-one-registry.
 */
import type { Answer, Answers, Questions } from "./types.js";

const isRec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const prob = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

export function normalizeAnswers(questions: Questions, raw: unknown): Answers | null {
  if (!isRec(raw)) return null;
  const out: Answers = {};
  for (const [id, q] of Object.entries(questions)) {
    const a = Object.hasOwn(raw, id) ? raw[id] : undefined;
    if (!isRec(a)) return null;
    let ans: Answer;
    if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      if (typeof a.choice !== "string" || !keys.includes(a.choice)) return null;
      let probabilities: Record<string, number>;
      if (a.probabilities === undefined) probabilities = Object.fromEntries(keys.map((k) => [k, k === a.choice ? 1 : 0]));
      else {
        if (!isRec(a.probabilities)) return null;
        probabilities = {};
        for (const k of keys) {
          const p = Object.hasOwn(a.probabilities, k) ? a.probabilities[k] : 0;
          if (!prob(p)) return null;
          probabilities[k] = p;
        }
        if (Object.keys(a.probabilities).some((k) => !keys.includes(k))) return null;
      }
      const confidence = a.confidence === undefined ? probabilities[a.choice] : a.confidence;
      if (!prob(confidence)) return null;
      ans = { choice: a.choice, probabilities, confidence };
    } else if (q.type === "score") {
      const levels = q.criteria.length;
      const s = a.score;
      if (typeof s !== "number" || !Number.isFinite(s) || s < 0 || s > levels - 1) return null;
      let probabilities: number[];
      if (a.probabilities === undefined) probabilities = q.criteria.map((_, i) => (i === Math.round(s) ? 1 : 0));
      else {
        if (!Array.isArray(a.probabilities) || a.probabilities.length !== levels || !a.probabilities.every(prob)) return null;
        probabilities = [...a.probabilities];
      }
      const confidence = a.confidence === undefined ? probabilities[Math.round(s)] : a.confidence;
      if (!prob(confidence)) return null;
      ans = { score: s, probabilities, confidence };
    } else {
      if (!prob(a.noul)) return null;
      ans = { noul: a.noul };
    }
    out[id] = ans;
  }
  return out;
}

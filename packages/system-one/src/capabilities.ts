/**
 * Capability checks. Per request (spec: system-one-adapter, "Capability check
 * per request"): estimated tokens = (state chars + longest question chars) ÷ 4
 * — under-counts CJK, accepted. Per consumer (settings-UI filter):
 * `incompatReasons`. A capability of `null` (unknown) never excludes.
 * See change: add-system-one-registry.
 */
import type { Capabilities, ConsumerRequires, Question, Questions } from "./types.js";

function questionChars(q: Question): number {
  let n = q.instructions.length;
  if (q.type === "choice") for (const [k, v] of Object.entries(q.criteria)) n += k.length + v.length;
  else if (q.type === "score") for (const v of q.criteria) n += v.length;
  else if (q.criteria) n += q.criteria.true.length + q.criteria.false.length;
  return n;
}

export function estimateTokens(state: string, questions: Questions): number {
  let longest = 0;
  for (const q of Object.values(questions)) longest = Math.max(longest, questionChars(q));
  return (state.length + longest) / 4;
}

/** `true` when the request fits the backend's known capabilities. */
export function fitsCapabilities(caps: Required<Capabilities>, state: string, questions: Questions): boolean {
  if (caps.maxContextTokens != null && estimateTokens(state, questions) > caps.maxContextTokens) return false;
  for (const q of Object.values(questions)) {
    if (caps.primitives != null && !caps.primitives.includes(q.type)) return false;
    if (q.type === "choice" && caps.maxOptions != null && Object.keys(q.criteria).length > caps.maxOptions) return false;
  }
  return true;
}

/** Why a backend cannot meet a consumer's declared `requires` ([] = compatible). */
export function incompatReasons(caps: Required<Capabilities>, req: ConsumerRequires | undefined): string[] {
  if (!req) return [];
  const out: string[] = [];
  if (req.minContextTokens != null && caps.maxContextTokens != null && caps.maxContextTokens < req.minContextTokens)
    out.push(`context ${caps.maxContextTokens} < ${req.minContextTokens}`);
  if (req.maxOptions != null && caps.maxOptions != null && caps.maxOptions < req.maxOptions)
    out.push(`options ${caps.maxOptions} < ${req.maxOptions}`);
  if (req.languages?.length && caps.languages != null && !caps.languages.includes("multi")) {
    const missing = req.languages.filter((l) => !caps.languages?.includes(l));
    if (missing.length) out.push(`language ${missing.join(",")}`);
  }
  if (req.primitives?.length && caps.primitives != null) {
    const missing = req.primitives.filter((p) => !caps.primitives?.includes(p));
    if (missing.length) out.push(`primitive ${missing.join(",")}`);
  }
  return out;
}

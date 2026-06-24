/**
 * Verified-signal extraction (tasks 3.1-3.5).
 * Detects five signal classes and admits a candidate only when its span ends in
 * a verified-good state (isError flip true->false on the same tool, a passing
 * check, or a following user confirmation). Unverified spans are dropped.
 *
 * Anchors per class (design.md "Signal -> anchor -> sink map"):
 *  - fault         : the isError flip
 *  - ask_user      : answer recorded
 *  - correction    : the human correction itself
 *  - procedure     : verified-good terminal state of the episode
 *  - documentation : cross-session frequency (verified later at the recurrence
 *                    gate, so it is exempt from the terminal gate here)
 */
import type {
  Candidate,
  CorrectionCandidate,
  DecisionCandidate,
  DocumentationCandidate,
  Episode,
  FaultCandidate,
  ProcedureCandidate,
  ToolResult,
  Trajectory,
  Turn,
} from "./types.js";
import { isCorrection } from "./segment.js";

const PASS_RE = /\b(tests?\s+pass|all\s+pass|0\s+errors?|exit\s+0|✓|passed)\b/i;
const RULE_RE = /\b(always|never|don['’]?t|do not|must|use\s+.+\s+instead|remember|prefer)\b/i;
const PROCEDURE_MIN_CALLS = 5; // strictly more than five

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

function errorClass(text: string): string {
  const m = text.match(/\b(ENOENT|EACCES|cannot find module|not found|undefined|type ?error|syntax ?error|permission denied|timeout)\b/i);
  if (m) return slug(m[1]);
  return slug(text.split(/[:\n]/)[0] ?? text).slice(0, 24);
}

function passingCheck(r: ToolResult | undefined): boolean {
  return !!r && !r.isError && PASS_RE.test(r.text);
}

/**
 * Verified-good is judged by the episode's TERMINAL state, not by any earlier
 * passing output — an episode that later ends in an error is NOT verified-good.
 */
export function episodeVerifiedGood(turns: Turn[]): boolean {
  const last = turns[turns.length - 1];
  if (last?.role === "user" && last.text && !isCorrection(last.text)) return true;
  const lastResult = [...turns].reverse().find((t) => t.toolResults.length)?.toolResults.at(-1);
  if (!lastResult) return false;
  return passingCheck(lastResult) || !lastResult.isError;
}

/** Task 3.1 — fault/correction: isError=true then retry same tool isError=false. */
export function detectFaults(traj: Trajectory): FaultCandidate[] {
  const out: FaultCandidate[] = [];
  const pairs = traj.pairs;
  for (let i = 0; i < pairs.length; i++) {
    const bad = pairs[i];
    if (!bad.result?.isError) continue;
    for (let j = i + 1; j < pairs.length; j++) {
      const fix = pairs[j];
      if (fix.call.name !== bad.call.name) continue;
      if (fix.result && !fix.result.isError) {
        out.push({
          signal: "fault",
          sessionId: traj.sessionId,
          model: traj.model,
          signature: `fault:${bad.call.name}:${errorClass(bad.result.text)}`,
          verified: true,
          wrongCall: bad.call,
          error: bad.result.text.slice(0, 300),
          fixCall: fix.call,
        });
        break;
      }
    }
  }
  return out;
}

/** Task 3.2 — ask_user decision: ask_user call + its result. */
export function detectDecisions(traj: Trajectory): DecisionCandidate[] {
  const out: DecisionCandidate[] = [];
  for (const p of traj.pairs) {
    if (p.call.name !== "ask_user" || !p.result) continue;
    const args = (p.call.arguments ?? {}) as Record<string, unknown>;
    const question = String(args.title ?? args.message ?? args.question ?? "decision");
    out.push({
      signal: "ask_user_decision",
      sessionId: traj.sessionId,
      model: traj.model,
      signature: `decision:${slug(question)}`,
      verified: true, // answer recorded
      question,
      answer: p.result.text.slice(0, 300),
    });
  }
  return out;
}

/** Task 3.3 — user correction: user msg (correction lexicon) after assistant action. */
export function detectCorrections(traj: Trajectory): CorrectionCandidate[] {
  const out: CorrectionCandidate[] = [];
  const turns = traj.turns;
  for (let i = 1; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.role !== "user" || !isCorrection(turn.text)) continue;
    // Look back past tool-result turns to the assistant action being corrected.
    let prev: Turn | undefined;
    for (let k = i - 1; k >= 0; k--) {
      if (turns[k].role === "toolResult") continue;
      prev = turns[k];
      break;
    }
    const prevWasAction =
      !!prev && prev.role === "assistant" && (prev.toolCalls.length > 0 || !!prev.text);
    if (!prevWasAction) continue;
    out.push({
      signal: "user_correction",
      sessionId: traj.sessionId,
      model: traj.model,
      signature: `correction:${slug(turn.text ?? "")}`,
      verified: true, // human correction is ground truth
      correction: (turn.text ?? "").slice(0, 300),
      precededBy: prev?.text?.slice(0, 160),
      rule: RULE_RE.test(turn.text ?? ""),
    });
  }
  return out;
}

/** Task 3.4 — procedure: episode with >5 toolCalls ending verified-good. */
export function detectProcedures(traj: Trajectory, episodes: Episode[]): ProcedureCandidate[] {
  const out: ProcedureCandidate[] = [];
  for (const ep of episodes) {
    const calls = ep.turns.flatMap((t) => t.toolCalls);
    if (calls.length <= PROCEDURE_MIN_CALLS) continue;
    if (!episodeVerifiedGood(ep.turns)) continue;
    const toolSequence = calls.map((c) => c.name);
    out.push({
      signal: "procedure",
      sessionId: traj.sessionId,
      model: traj.model,
      signature: `procedure:${toolSequence.join(">")}`,
      verified: true,
      toolSequence,
      userPrompt: ep.userPrompt,
    });
  }
  return out;
}

/** Documentation candidates: assistant summary turns (anchored later by recurrence). */
export function detectDocumentation(traj: Trajectory): DocumentationCandidate[] {
  const out: DocumentationCandidate[] = [];
  for (const t of traj.turns) {
    if (t.role !== "assistant" || !t.text) continue;
    const looksLikeSummary = /(^|\n)#{1,4}\s|\n[-*]\s|\n\d+\.\s/.test(t.text) && t.text.length > 200;
    if (!looksLikeSummary) continue;
    out.push({
      signal: "documentation",
      sessionId: traj.sessionId,
      model: traj.model,
      signature: `doc:${slug(t.text.split("\n")[0] ?? "")}`,
      verified: false, // anchored on cross-session frequency at recurrence gate
      summary: t.text.slice(0, 600),
    });
  }
  return out;
}

/** Task 3.5 — verification anchor gate. Documentation deferred to recurrence. */
export function verificationGate(candidates: Candidate[]): Candidate[] {
  return candidates.filter((c) => c.signal === "documentation" || c.verified);
}

/** Run every detector + apply the gate. */
export function extractSignals(traj: Trajectory, episodes: Episode[]): Candidate[] {
  const all: Candidate[] = [
    ...detectFaults(traj),
    ...detectDecisions(traj),
    ...detectCorrections(traj),
    ...detectProcedures(traj, episodes),
    ...detectDocumentation(traj),
  ];
  return verificationGate(all);
}

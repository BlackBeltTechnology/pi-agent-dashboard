/**
 * Case builder: a port of the v0 `cases.py` plus its later patches (design M3).
 * Pure over parsed sessions; `buildCasesCommand` (commands/cases.ts) does the I/O.
 */
import type { ParsedSessions, UserEv } from "./events.js";
import { type FailureOccurrence, failuresIn, faultQuery, isGenericSignature } from "./signature.js";
import { mulberry32, sha256 } from "./util.js";

export type CaseType = "recurring_fault" | "user_flagged" | "explicit_ref" | "negative";
export const POSITIVE_TYPES: CaseType[] = ["recurring_fault", "user_flagged", "explicit_ref"];

export interface Case {
  id: string;
  type: CaseType;
  sessionId: string;
  /** Decision time: timestamp of the triggering event, UTC ISO-8601. */
  decisionTime: string;
  query: string;
  context: string;
  goldSessions: string[];
  /** `sha256(query|context|sorted goldSessions)`; the verdict cache keys on it. */
  contentHash: string;
  signature?: string;
}

export interface Quotas {
  recurring: number;
  negatives: number;
}
const DEFAULT_QUOTAS: Quotas = { recurring: 60, negatives: 30 };
export const DEFAULT_SEED = 5;

export interface CaseSet {
  version: 1;
  caseSetHash: string;
  seed: number;
  quotas: Quotas;
  counts: { candidates: Record<CaseType, number>; sampled: Record<CaseType, number> };
  excludedSignatures: number;
  inputFingerprint: { files: number; sha256: string };
  cases: Case[];
}

const RECURRENCE =
  /\b(again|other session|another session|previous session|already (fixed|solved|did|done)|same (error|issue|problem|bug)|last time)\b|megint|kor[áa]bban|ugyanaz|m[áa]r (jav[ií]tottuk|megoldottuk)/i;
const SKIP_PREFIX = /^\s*(<skill|# |---|You are)/;
const LOG_LINE = /^\s*at .*\(.*:\d+(:\d+)?\)|\bError:|Traceback|\[(INFO|WARN|ERROR)[\]|]|^\s*\d{2}:\d{2}:\d{2}/;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const OTHER_SESSION = /\b(another|other)\s+sessions?\b/i;

function looksLikePastedLog(text: string): boolean {
  if (text.includes("```")) return true;
  return text.split("\n").filter((l) => LOG_LINE.test(l)).length >= 2;
}

function caseOf(c: Omit<Case, "id" | "contentHash"> & { idKey: string }): Case {
  const { idKey, ...rest } = c;
  const gold = [...rest.goldSessions].sort();
  return {
    id: sha256(`${rest.type}|${rest.sessionId}|${rest.decisionTime}|${idKey}`).slice(0, 12),
    ...rest,
    goldSessions: gold,
    contentHash: sha256(`${rest.query}|${rest.context}|${gold.join(",")}`),
  };
}

interface Candidates {
  recurring: Case[];
  negatives: Case[];
  userFlagged: Case[];
  explicitRefs: Case[];
  excludedSignatures: number;
}

function otherSessionGold(text: string, session: string): string[] | null {
  const uuids = text.match(UUID) ?? [];
  if (!OTHER_SESSION.test(text) || !uuids.length) return null;
  return [...new Set(uuids.map((u) => u.toLowerCase()))].filter((u) => u !== session.toLowerCase());
}

function userCase(e: UserEv, session: string): Case | null {
  const text = e.text.trim();
  if (!text || SKIP_PREFIX.test(text)) return null;
  const base = { sessionId: session, decisionTime: e.ts, query: text.slice(0, 200), context: text, idKey: text };
  const gold = otherSessionGold(text, session);
  if (gold) {
    // An explicit-reference turn is never also user_flagged; naming only its own session yields no case.
    return gold.length ? caseOf({ ...base, type: "explicit_ref", goldSessions: gold }) : null;
  }
  if (text.length >= 400 || !RECURRENCE.test(text) || looksLikePastedLog(text)) return null;
  return caseOf({ ...base, type: "user_flagged", goldSessions: [] });
}

function userCases(parsed: ParsedSessions): { userFlagged: Case[]; explicitRefs: Case[] } {
  const userFlagged: Case[] = [];
  const explicitRefs: Case[] = [];
  for (const session of parsed.sessions) {
    for (const e of parsed.bySession.get(session) ?? []) {
      const c = e.kind === "user" ? userCase(e, session) : null;
      if (c) (c.type === "explicit_ref" ? explicitRefs : userFlagged).push(c);
    }
  }
  return { userFlagged, explicitRefs };
}

function faultContext(f: FailureOccurrence): string {
  return `${f.call.tool}: ${f.head}\n${f.result.text.slice(0, 600)}`;
}

/** `solvedMs`: when the earliest changed-approach fix in that session landed (null = never). */
type PerSession = Map<string, { first: FailureOccurrence; solvedMs: number | null }>;

/** Fold one failure into its signature's per-session record (first failure wins; earliest fix wins). */
function recordFailure(per: PerSession, session: string, f: FailureOccurrence): void {
  const solvedMs = f.fixChanged ? f.fixMs : null;
  const cur = per.get(session);
  if (!cur) per.set(session, { first: f, solvedMs });
  else if (solvedMs !== null && (cur.solvedMs === null || solvedMs < cur.solvedMs)) cur.solvedMs = solvedMs;
}

/** signature -> per-session first failure + when a changed-approach fix landed there. */
function groupBySignature(parsed: ParsedSessions): Map<string, PerSession> {
  const bySig = new Map<string, PerSession>();
  for (const session of parsed.sessions) {
    for (const f of failuresIn(session, parsed.bySession.get(session) ?? [])) {
      let per = bySig.get(f.signature);
      if (!per) bySig.set(f.signature, (per = new Map()));
      recordFailure(per, session, f);
    }
  }
  return bySig;
}

function faultCase(type: "recurring_fault" | "negative", session: string, f: FailureOccurrence, sig: string, gold: string[]): Case {
  return caseOf({ type, sessionId: session, decisionTime: f.result.ts, query: faultQuery(f.head, f.result.text), context: faultContext(f), goldSessions: gold, signature: sig, idKey: sig });
}

function casesForSignature(sig: string, per: PerSession): { recurring: Case[]; negatives: Case[] } {
  const ordered = [...per.entries()].sort((a, b) => a[1].first.result.ms - b[1].first.result.ms || (a[0] < b[0] ? -1 : 1));
  if (ordered.length === 1) return { recurring: [], negatives: [faultCase("negative", ordered[0][0], ordered[0][1].first, sig, [])] };
  const recurring: Case[] = [];
  for (let i = 1; i < ordered.length; i++) {
    // An earlier session is gold only if its fix existed when this case's decision was made.
    const decisionMs = ordered[i][1].first.result.ms;
    const gold = ordered.slice(0, i).filter(([, v]) => v.solvedMs !== null && v.solvedMs < decisionMs).map(([s]) => s);
    if (gold.length) recurring.push(faultCase("recurring_fault", ordered[i][0], ordered[i][1].first, sig, gold));
  }
  return { recurring, negatives: [] };
}

function buildCandidates(parsed: ParsedSessions): Candidates {
  const frequentAbove = Math.max(3, 0.05 * parsed.sessions.length);
  const recurring: Case[] = [];
  const negatives: Case[] = [];
  let excluded = 0;
  for (const [sig, per] of [...groupBySignature(parsed).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (isGenericSignature(sig) || per.size > frequentAbove) {
      excluded++;
      continue;
    }
    const c = casesForSignature(sig, per);
    recurring.push(...c.recurring);
    negatives.push(...c.negatives);
  }
  return { recurring, negatives, ...userCases(parsed), excludedSignatures: excluded };
}

const byId = (a: Case, b: Case) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Seeded sample of `n` from candidates sorted by id (Fisher–Yates over mulberry32). */
function sampleCases(cands: Case[], n: number, seed: number): Case[] {
  const sorted = [...cands].sort(byId);
  if (sorted.length <= n) return sorted;
  const rnd = mulberry32(seed);
  const a = sorted;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n).sort(byId);
}

export function caseSetHash(cases: Case[]): string {
  return sha256([...cases].sort(byId).map((c) => `${c.id}:${c.contentHash}`).join("\n"));
}

function inputFingerprint(files: { file: string; sha256: string }[]): { files: number; sha256: string } {
  const sorted = [...files].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { files: sorted.length, sha256: sha256(sorted.map((f) => `${f.file}:${f.sha256}`).join("\n")) };
}

export function buildCaseSet(parsed: ParsedSessions, opts: { seed?: number; quotas?: Partial<Quotas> } = {}): CaseSet {
  const seed = opts.seed ?? DEFAULT_SEED;
  const quotas = { ...DEFAULT_QUOTAS, ...opts.quotas };
  const c = buildCandidates(parsed);
  const sampledRecurring = sampleCases(c.recurring, quotas.recurring, seed);
  const sampledNegatives = sampleCases(c.negatives, quotas.negatives, seed);
  const userFlagged = [...c.userFlagged].sort(byId);
  const explicitRefs = [...c.explicitRefs].sort(byId);
  const cases = [...sampledRecurring, ...userFlagged, ...explicitRefs, ...sampledNegatives];
  return {
    version: 1,
    caseSetHash: caseSetHash(cases),
    seed,
    quotas,
    counts: {
      candidates: { recurring_fault: c.recurring.length, user_flagged: c.userFlagged.length, explicit_ref: c.explicitRefs.length, negative: c.negatives.length },
      sampled: { recurring_fault: sampledRecurring.length, user_flagged: userFlagged.length, explicit_ref: explicitRefs.length, negative: sampledNegatives.length },
    },
    excludedSignatures: c.excludedSignatures,
    inputFingerprint: inputFingerprint(parsed.files),
    cases,
  };
}


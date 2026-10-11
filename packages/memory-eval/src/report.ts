/**
 * Aggregation and rendering (design M6). The renderer's input type holds only
 * counts, rates, intervals, retriever ids and versions, the judge model, the
 * prompt version and hashes: no field is typed to carry case or retrieved text.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Case, type CaseType, POSITIVE_TYPES } from "./cases.js";
import { casePath, readCaseSet } from "./commands/cases.js";
import { loadVerdicts } from "./commands/judge.js";
import { type JudgeInfo, type RetrievedFile, type RunManifest, readJson, runDir } from "./commands/run.js";
import { keyString, outputHash, type VerdictKey } from "./judge.js";
import type { CaseResult } from "./retriever.js";
import { mcnemarExact, median, pct, wilson } from "./stats.js";
import { CliError } from "./util.js";
import type { WorkPaths } from "./workdir.js";

const SANITY_CENTER = 0.34;
const SANITY_BAND = 0.15;
const SANITY_RETRIEVER = "hermes.session_search.recent";
const isOldStack = (id: string) => id.startsWith("hermes.");

type ValidityState = "valid" | "invalid" | "unjudged";
type HelpState = "helpful" | "not_helpful" | "unjudged";

export interface RunData {
  runId: string;
  cases: Case[];
  retrieved: RetrievedFile;
  manifest: RunManifest;
  validity(caseId: string): ValidityState;
  helpful(retrieverId: string, caseId: string): HelpState;
  /** Items that need a verdict for this run, and how many have one. */
  coverage(): { judged: number; unjudged: number };
}

type Reader = { validity: RunData["validity"]; helpful: RunData["helpful"] };

/** Verdict lookup for one run, keyed by the judge recorded in its manifest. */
function verdictReader(retrieved: RetrievedFile, cases: Case[], j: JudgeInfo, verdicts: ReturnType<typeof loadVerdicts>): Reader {
  const judged = Boolean(j.model && j.model !== "absent");
  const base = { promptVersion: j.promptVersion ?? "", promptSha256: j.promptSha256 ?? "", scrubSha256: j.scrubSha256 ?? "", judgeModel: j.model ?? "" };
  const byId = new Map(cases.map((c) => [c.id, c]));
  const get = (k: VerdictKey) => (judged ? verdicts.get(keyString(k))?.verdict : undefined);
  return {
    validity(caseId) {
      const v = get({ kind: "validity", caseId, caseContentHash: byId.get(caseId)!.contentHash, ...base });
      return v === "valid" || v === "invalid" ? v : "unjudged";
    },
    helpful(rid, caseId) {
      const r: CaseResult | undefined = retrieved.results[rid]?.[caseId];
      if (!r) return "unjudged";
      if (!r.top5.length) return "not_helpful"; // nothing returned: not helpful by construction
      const ver = retrieved.retrievers.find((x) => x.id === rid)?.version ?? "";
      const v = get({ kind: "helpfulness", caseId, caseContentHash: byId.get(caseId)!.contentHash, outputHash: outputHash(rid, ver, r.top5), ...base });
      return v === "helpful" || v === "not_helpful" ? v : "unjudged";
    },
  };
}

function coverageOf(retrieved: RetrievedFile, cases: Case[], rd: Reader): { judged: number; unjudged: number } {
  let done = 0;
  let missing = 0;
  const count = (state: string) => (state === "unjudged" ? missing++ : done++);
  for (const c of cases) {
    const v = rd.validity(c.id);
    count(v);
    if (v !== "valid") continue;
    for (const r of retrieved.retrievers) {
      if (r.status === "ok" && retrieved.results[r.id]?.[c.id]?.top5.length) count(rd.helpful(r.id, c.id));
    }
  }
  return { judged: done, unjudged: missing };
}

export function loadRun(p: WorkPaths, runId: string): RunData {
  const dir = runDir(p.runsDir, runId);
  const retrieved = readJson<RetrievedFile>(join(dir, "retrieved.json"));
  const manifest = readJson<RunManifest>(join(dir, "manifest.json"));
  const caseSet = readCaseSet(casePath(p.casesDir, retrieved.caseSetName));
  if (caseSet.caseSetHash !== retrieved.caseSetHash) throw new CliError(`case set '${retrieved.caseSetName}' changed since run ${runId} (hash ${caseSet.caseSetHash} vs ${retrieved.caseSetHash})`);
  const cases = caseSet.cases;
  const rd = verdictReader(retrieved, cases, manifest.judge ?? {}, loadVerdicts(p.verdicts));
  return { runId, cases, retrieved, manifest, ...rd, coverage: () => coverageOf(retrieved, cases, rd) };
}

// ---------------------------------------------------------------- aggregate

interface Rate {
  k: number;
  n: number;
  lo: number;
  hi: number;
}
const rate = (k: number, n: number): Rate => ({ k, n, ...wilson(k, n) });

interface TypeRow {
  cases: number;
  valid: number;
  invalid: number;
  validityUnjudged: number;
  helpful: Rate;
  helpfulnessUnjudged: number;
}
interface NegativesRow {
  cases: number;
  valid: number;
  invalid: number;
  validityUnjudged: number;
  returnedAnything: Rate;
  abstention: Rate;
  judgedHelpful: Rate;
  helpfulnessUnjudged: number;
}
interface GoldRow {
  n: number;
  hit5: number;
  hit10: number;
}
interface RetrieverAgg {
  id: string;
  version: string;
  asOf: "strict" | "none";
  status: "ok" | "unavailable";
  positives: { overall: TypeRow; byType: Record<string, TypeRow> };
  negatives: NegativesRow;
  medianSize: number | null;
  gold: Record<string, GoldRow>;
  counts: { asOfViolations: number; underFill: number; ownSessionHits: number; ownSessionTotal: number; ownSessionDropped: number; invalidHits: number; errors: number };
}
interface UnionAgg {
  retrieverIds: string[];
  overall: Rate;
  byType: Record<string, Rate>;
}
export interface Aggregate {
  runId: string;
  caseSet: { name: string; hash: string; counts: Record<string, number> };
  judge: { role: string; model: string; promptVersion: string; judged: boolean };
  coverage: { judged: number; unjudged: number };
  retrievers: RetrieverAgg[];
  union: UnionAgg | null;
  sanity: { retrieverId: string; rate: Rate; flagged: boolean } | null;
}

interface Tally {
  valid: number;
  invalid: number;
  validityUnjudged: number;
  returned: number;
  helpful: number;
  judged: number;
  helpfulnessUnjudged: number;
}

function tallyHelp(t: Tally, h: HelpState): void {
  if (h === "unjudged") {
    t.helpfulnessUnjudged++;
    return;
  }
  t.judged++;
  if (h === "helpful") t.helpful++;
}

/** Per-case validity/helpfulness tally for one retriever over `cases`. */
function tally(run: RunData, rid: string, cases: Case[]): Tally {
  const t: Tally = { valid: 0, invalid: 0, validityUnjudged: 0, returned: 0, helpful: 0, judged: 0, helpfulnessUnjudged: 0 };
  for (const c of cases) {
    const v = run.validity(c.id);
    if (v === "invalid") t.invalid++;
    else if (v === "unjudged") t.validityUnjudged++;
    else {
      t.valid++;
      if (run.retrieved.results[rid]?.[c.id]?.top5.length) t.returned++;
      tallyHelp(t, run.helpful(rid, c.id));
    }
  }
  return t;
}

function typeRow(run: RunData, rid: string, cases: Case[]): TypeRow {
  const t = tally(run, rid, cases);
  return { cases: cases.length, valid: t.valid, invalid: t.invalid, validityUnjudged: t.validityUnjudged, helpful: rate(t.helpful, t.judged), helpfulnessUnjudged: t.helpfulnessUnjudged };
}

function negativesRow(run: RunData, rid: string, cases: Case[]): NegativesRow {
  const t = tally(run, rid, cases);
  return {
    cases: cases.length,
    valid: t.valid,
    invalid: t.invalid,
    validityUnjudged: t.validityUnjudged,
    returnedAnything: rate(t.returned, t.valid),
    abstention: rate(t.valid - t.returned, t.valid),
    judgedHelpful: rate(t.helpful, t.judged),
    helpfulnessUnjudged: t.helpfulnessUnjudged,
  };
}

function goldRows(run: RunData, rid: string): Record<string, GoldRow> {
  const out: Record<string, GoldRow> = {};
  for (const type of ["recurring_fault", "explicit_ref"] as CaseType[]) {
    const cs = run.cases.filter((c) => c.type === type && c.goldSessions.length);
    let h5 = 0;
    let h10 = 0;
    for (const c of cs) {
      const refs = run.retrieved.results[rid]?.[c.id]?.top10 ?? [];
      const gold = new Set(c.goldSessions);
      if (refs.slice(0, 5).some((r) => r.sessionId && gold.has(r.sessionId))) h5++;
      if (refs.slice(0, 10).some((r) => r.sessionId && gold.has(r.sessionId))) h10++;
    }
    out[type] = { n: cs.length, hit5: h5, hit10: h10 };
  }
  return out;
}

export function aggregate(run: RunData): Aggregate {
  const positives = run.cases.filter((c) => (POSITIVE_TYPES as string[]).includes(c.type));
  const negatives = run.cases.filter((c) => c.type === "negative");
  const retrievers: RetrieverAgg[] = run.retrieved.retrievers.map((r) => {
    const results = Object.values(run.retrieved.results[r.id] ?? {});
    const sizes = results.filter((x) => x.top5.length).map((x) => x.top5.reduce((n, h) => n + h.text.length, 0));
    return {
      id: r.id,
      version: r.version,
      asOf: r.asOf,
      status: r.status,
      positives:
        r.status === "ok"
          ? { overall: typeRow(run, r.id, positives), byType: Object.fromEntries(POSITIVE_TYPES.map((t) => [t, typeRow(run, r.id, positives.filter((c) => c.type === t))])) }
          : { overall: typeRow(run, r.id, []), byType: {} },
      negatives: negativesRow(run, r.id, r.status === "ok" ? negatives : []),
      medianSize: median(sizes),
      gold: r.status === "ok" && r.sessionBacked ? goldRows(run, r.id) : {},
      counts: {
        asOfViolations: results.reduce((n, x) => n + x.asOfViolations, 0),
        underFill: results.filter((x) => x.underFill).length,
        ownSessionHits: results.reduce((n, x) => n + (x.ownTop5?.own ?? 0), 0),
        ownSessionTotal: results.reduce((n, x) => n + (x.ownTop5?.total ?? 0), 0),
        ownSessionDropped: results.reduce((n, x) => n + x.ownSessionDropped, 0),
        invalidHits: results.reduce((n, x) => n + x.invalidHits, 0),
        errors: results.filter((x) => x.error).length,
      },
    };
  });

  // Union: any as-of old-stack retriever helpful, over cases judged for EVERY constituent.
  const members = run.retrieved.retrievers.filter((r) => r.status === "ok" && r.asOf === "strict" && isOldStack(r.id)).map((r) => r.id);
  let union: UnionAgg | null = null;
  if (members.length) {
    const calc = (cs: Case[]): Rate => {
      let k = 0;
      let n = 0;
      for (const c of cs) {
        if (run.validity(c.id) !== "valid") continue;
        const hs = members.map((m) => run.helpful(m, c.id));
        if (hs.includes("unjudged")) continue;
        n++;
        if (hs.includes("helpful")) k++;
      }
      return rate(k, n);
    };
    union = { retrieverIds: members, overall: calc(positives), byType: Object.fromEntries(POSITIVE_TYPES.map((t) => [t, calc(positives.filter((c) => c.type === t))])) };
  }

  const san = retrievers.find((r) => r.id === SANITY_RETRIEVER && r.status === "ok");
  const sanity = san && san.positives.overall.helpful.n > 0 ? { retrieverId: san.id, rate: san.positives.overall.helpful, flagged: Math.abs(san.positives.overall.helpful.k / san.positives.overall.helpful.n - SANITY_CENTER) > SANITY_BAND } : null;
  const j = run.manifest.judge ?? {};
  const counts: Record<string, number> = {};
  for (const c of run.cases) counts[c.type] = (counts[c.type] ?? 0) + 1;
  return {
    runId: run.runId,
    caseSet: { name: run.retrieved.caseSetName, hash: run.retrieved.caseSetHash, counts },
    judge: { role: j.role ?? "absent", model: j.model ?? "absent", promptVersion: j.promptVersion ?? "absent", judged: Boolean(j.model && j.model !== "absent") },
    coverage: run.coverage(),
    retrievers,
    union,
    sanity,
  };
}

// ----------------------------------------------------------------- render

const cell = (r: Rate) => (r.n ? `${r.k}/${r.n} (${pct(r.k / r.n)})` : `0/0`);
const ci = (r: Rate) => (r.n ? `${pct(r.lo)}–${pct(r.hi)}` : "—");

function renderRetriever(r: RetrieverAgg): string {
  const L: string[] = [`### ${r.id} v${r.version} (asOf: ${r.asOf})`, ""];
  if (r.status === "unavailable") return `${L.join("\n")}\nunavailable — no figures\n`;
  L.push("| positives | cases | valid | invalid | validity unjudged | helpful@5 | 95% CI | helpfulness unjudged |", "|---|---|---|---|---|---|---|---|");
  const row = (name: string, t: TypeRow) => `| ${name} | ${t.cases} | ${t.valid} | ${t.invalid} | ${t.validityUnjudged} | ${cell(t.helpful)} | ${ci(t.helpful)} | unjudged: ${t.helpfulnessUnjudged} |`;
  L.push(row("all positives", r.positives.overall));
  for (const [t, v] of Object.entries(r.positives.byType)) L.push(row(t, v));
  const n = r.negatives;
  L.push(
    "",
    `Negatives (${n.cases} cases, ${n.valid} valid, ${n.invalid} invalid, ${n.validityUnjudged} validity-unjudged):`,
    `- returned anything (false injection if delivered): ${cell(n.returnedAnything)}`,
    `- abstention (returned nothing): ${cell(n.abstention)}`,
    `- judged-helpful: ${cell(n.judgedHelpful)} (helpfulness unjudged: ${n.helpfulnessUnjudged})`,
    "",
    `- median injected size: ${r.medianSize === null ? "—" : `${r.medianSize} chars`}`,
  );
  for (const [t, g] of Object.entries(r.gold)) if (g.n) L.push(`- gold-session hit@5 / hit@10 (${t}): ${g.hit5}/${g.n} / ${g.hit10}/${g.n}`);
  const c = r.counts;
  L.push(`- as-of violations: ${c.asOfViolations}; under-fill: ${c.underFill}; invalid hits: ${c.invalidHits}; errors: ${c.errors}`);
  if (c.ownSessionTotal || c.ownSessionDropped) L.push(`- own-session share of top-5 (before exclusion): ${c.ownSessionHits}/${c.ownSessionTotal}; own-session hits caught by the harness backstop: ${c.ownSessionDropped} (adapters exclude in-query)`);
  return `${L.join("\n")}\n`;
}

export function renderReport(a: Aggregate): string {
  const L: string[] = [
    `# Tier R report — run ${a.runId}`,
    "",
    `- case set: ${a.caseSet.name} (hash ${a.caseSet.hash})`,
    `- cases: ${Object.entries(a.caseSet.counts).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    `- judge: ${a.judge.judged ? `${a.judge.role !== "absent" ? `${a.judge.role} → ` : ""}${a.judge.model}, prompt ${a.judge.promptVersion}` : "NOT JUDGED (run `memory-eval judge`)"}`,
    `- verdict coverage: ${a.coverage.judged} judged, ${a.coverage.unjudged} unjudged`,
    "",
    "## As-of old-stack retrievers",
    "",
  ];
  const strict = a.retrievers.filter((r) => r.asOf === "strict");
  for (const r of strict) L.push(renderRetriever(r));
  L.push("### recall (blackhole)", "", "0% by construction: its scope is the current session only, so it never answers a cross-session case.", "");
  if (a.union) {
    L.push(`### Union — any of ${a.union.retrieverIds.join(", ")} helpful`, "", `Over the cases judged for every constituent. Overall: ${cell(a.union.overall)} (95% CI ${ci(a.union.overall)}), n = ${a.union.overall.n}.`);
    for (const [t, r] of Object.entries(a.union.byType)) L.push(`- ${t}: ${cell(r)} (95% CI ${ci(r)}), n = ${r.n}`);
    L.push("");
  }
  if (a.sanity) {
    L.push(
      `### Sanity band`,
      "",
      `${a.sanity.retrieverId} helpful@5 = ${cell(a.sanity.rate)}; v0 reference ${pct(SANITY_CENTER, 0)} ± ${Math.round(SANITY_BAND * 100)} points: ${a.sanity.flagged ? "**FLAGGED — outside the band; explain before committing** (case set, judge or own-session exclusion may differ from v0)" : "inside the band"}.`,
      "",
    );
  }
  const none = a.retrievers.filter((r) => r.asOf === "none");
  if (none.length) {
    L.push("## Non-as-of references (not in the union, not an as-of claim)", "");
    for (const r of none) L.push(renderRetriever(r));
  }
  return `${L.join("\n")}\n`;
}

// ---------------------------------------------------------------- compare

interface PairRow {
  a: string;
  b: string;
  n: number;
  wins: number;
  losses: number;
  ties: number;
  p: number;
}
export interface Comparison {
  runA: string;
  runB: string;
  caseSetHash: string;
  judgeA: string;
  judgeB: string;
  promptA: string;
  promptB: string;
  mismatch: boolean;
  pairs: PairRow[];
}

function gateComparison(A: RunData, B: RunData, allowJudgeMismatch: boolean | undefined): { ja: JudgeInfo; jb: JudgeInfo; mismatch: boolean } {
  if (A.retrieved.caseSetHash !== B.retrieved.caseSetHash) {
    throw new CliError(`cannot compare runs on different case sets: ${A.runId} has ${A.retrieved.caseSetHash}, ${B.runId} has ${B.retrieved.caseSetHash}`);
  }
  const ja = A.manifest.judge ?? {};
  const jb = B.manifest.judge ?? {};
  const mismatch = ja.model !== jb.model || ja.promptVersion !== jb.promptVersion;
  if (mismatch && !allowJudgeMismatch) {
    throw new CliError(`cannot compare runs judged differently: ${A.runId} judge ${ja.model} (prompt ${ja.promptVersion}), ${B.runId} judge ${jb.model} (prompt ${jb.promptVersion}); pass --allow-judge-mismatch to compare anyway`);
  }
  return { ja, jb, mismatch };
}

function pairRow(A: RunData, B: RunData, a: string, b: string, positives: Case[]): PairRow {
  let wins = 0;
  let losses = 0;
  let n = 0;
  for (const c of positives) {
    if (A.validity(c.id) !== "valid" || B.validity(c.id) !== "valid") continue;
    const x = A.helpful(a, c.id);
    const y = B.helpful(b, c.id);
    if (x === "unjudged" || y === "unjudged") continue;
    n++;
    if (x === "helpful" && y !== "helpful") wins++;
    else if (y === "helpful" && x !== "helpful") losses++;
  }
  return { a, b, n, wins, losses, ties: n - wins - losses, p: mcnemarExact(wins, losses) };
}

export function compareRuns(A: RunData, B: RunData, opts: { allowJudgeMismatch?: boolean } = {}): Comparison {
  const { ja, jb, mismatch } = gateComparison(A, B, opts.allowJudgeMismatch);
  const positives = A.cases.filter((c) => (POSITIVE_TYPES as string[]).includes(c.type));
  const okIds = (r: RunData) => r.retrieved.retrievers.filter((x) => x.status === "ok").map((x) => x.id);
  const pairs = okIds(A).flatMap((a) => okIds(B).map((b) => pairRow(A, B, a, b, positives)));
  return { runA: A.runId, runB: B.runId, caseSetHash: A.retrieved.caseSetHash, judgeA: ja.model ?? "absent", judgeB: jb.model ?? "absent", promptA: ja.promptVersion ?? "absent", promptB: jb.promptVersion ?? "absent", mismatch, pairs };
}

export function renderComparison(c: Comparison): string {
  const L = [`# Tier R comparison — ${c.runA} (A) vs ${c.runB} (B)`, "", `- case set hash: ${c.caseSetHash}`, `- judge A: ${c.judgeA} (prompt ${c.promptA}); judge B: ${c.judgeB} (prompt ${c.promptB})`];
  if (c.mismatch) L.push("", `> **JUDGE MISMATCH** — the runs were judged by different models or prompts (${c.judgeA} vs ${c.judgeB}); differences may reflect the judge, not the retriever.`);
  L.push("", "Over valid positives judged in both runs. Win = helpful in A only; loss = helpful in B only. p = exact two-sided McNemar.", "", "| A | B | n | wins | losses | ties | p |", "|---|---|---|---|---|---|---|");
  for (const p of c.pairs) L.push(`| ${p.a} | ${p.b} | ${p.n} | ${p.wins} | ${p.losses} | ${p.ties} | ${p.p.toFixed(4)} |`);
  return `${L.join("\n")}\n`;
}

export function existsRun(p: WorkPaths, runId: string): boolean {
  return existsSync(join(runDir(p.runsDir, runId), "retrieved.json"));
}

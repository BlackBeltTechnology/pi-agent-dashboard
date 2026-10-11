/**
 * `memory-eval judge`: validity per case, helpfulness per (case, retriever
 * output); cached by content hash; consent-gated; failures yield `unjudged`.
 * See change: add-memory-eval-tier-r (design M5).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import type { Case } from "../cases.js";
import type { Ctx } from "../ctx.js";
import {
  BATCH_SIZE,
  buildBatchPayload,
  DATA_CLASSES,
  helpfulnessItem,
  JUDGE_TIMEOUT_MS,
  type JudgeItem,
  judgeArgs,
  keyString,
  outputHash,
  type ParsedAnswer,
  parseAnswer,
  promptVersionOf,
  type ResolvedJudge,
  resolveJudge,
  type Verdict,
  type VerdictKey,
  type VerdictRecord,
  validityItem,
} from "../judge.js";
import { SCRUB_RULES, type ScrubRule, scrubRulesFingerprint } from "../scrub.js";
import { CliError, sha256, stableJson } from "../util.js";
import { ensureWorkDir, resolvePaths, type WorkPaths, writeSecure } from "../workdir.js";
import { casePath, readCaseSet } from "./cases.js";
import { latestRunId, type RetrievedFile, type RunManifest, readJson, runDir } from "./run.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROMPT = resolve(HERE, "..", "..", "prompts", "judge.v1.md");

export interface JudgeArgs {
  run?: string;
  judge?: string;
  yes?: boolean;
  dryRun?: boolean;
}

interface PiResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runPi(ctx: Ctx, args: string[], cwd: string, input: string, timeoutMs: number): Promise<PiResult> {
  return new Promise((res) => {
    const [cmd, ...pre] = ctx.piCommand;
    const child = spawn(cmd, [...pre, ...args], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = (s: string, add: Buffer) => (s.length > 5_000_000 ? s : s + add.toString("utf8"));
    child.stdout?.on("data", (d: Buffer) => (stdout = cap(stdout, d)));
    child.stderr?.on("data", (d: Buffer) => (stderr = cap(stderr, d)));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      res({ exitCode: null, stdout, stderr: `${stderr}${e.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      res({ exitCode: code, stdout, stderr, timedOut });
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

export function loadVerdicts(path: string): Map<string, VerdictRecord> {
  const m = new Map<string, VerdictRecord>();
  if (!existsSync(path)) return m;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as VerdictRecord;
      m.set(keyString(r), r);
    } catch {
      /* skip a torn line */
    }
  }
  return m;
}

const chunk = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const tail = (s: string, n = 400) => s.trim().slice(-n);

interface Session {
  ctx: Ctx;
  dir: string;
  judgeRef: string;
  promptText: string;
  rules: ScrubRule[];
  base: Omit<VerdictKey, "kind" | "caseId" | "caseContentHash" | "outputHash">;
  verdicts: Map<string, VerdictRecord>;
  verdictsPath: string;
  workDir: string;
}

const keyOf = (s: Session, it: JudgeItem): VerdictKey => ({ kind: it.kind, caseId: it.caseId, caseContentHash: it.caseContentHash, ...(it.outputHash ? { outputHash: it.outputHash } : {}), ...s.base });
const cached = (s: Session, it: JudgeItem) => s.verdicts.has(keyString(keyOf(s, it)));

function record(s: Session, it: JudgeItem, v: { verdict: Verdict; note: string }): void {
  const rec: VerdictRecord = { ...keyOf(s, it), ...(it.retrieverId ? { retrieverId: it.retrieverId } : {}), verdict: v.verdict, note: v.note, at: (s.ctx.now?.() ?? new Date()).toISOString() };
  s.verdicts.set(keyString(rec), rec);
  writeSecure(s.verdictsPath, `${JSON.stringify(rec)}\n`, { flag: "a" });
}

type CallResult = { error: string; parsed: Extract<ParsedAnswer, { ok: true }> | null };

/** One `pi -p` call; appends to judge-calls.jsonl. */
async function call(s: Session, batchId: string, attempt: number, items: JudgeItem[]): Promise<CallResult> {
  const timeoutMs = s.ctx.judgeTimeoutMs ?? JUDGE_TIMEOUT_MS;
  const payload = buildBatchPayload(s.promptText, items, s.rules);
  const t0 = Date.now();
  const r = await runPi(s.ctx, judgeArgs(s.judgeRef), s.workDir, payload, timeoutMs);
  let outcome: "ok" | "partial" | "failed" | "timeout" | "malformed" = "ok";
  let error = "";
  let parsed: CallResult["parsed"] = null;
  if (r.timedOut) [outcome, error] = ["timeout", `judge call timed out after ${timeoutMs} ms`];
  else if (r.exitCode !== 0) [outcome, error] = ["failed", `judge exited ${r.exitCode}: ${tail(r.stderr || r.stdout)}`];
  else {
    const a = parseAnswer(r.stdout, items);
    if (a.ok) {
      parsed = a;
      if (a.verdicts.size < items.length) outcome = "partial";
    } else [outcome, error] = ["malformed", a.error];
  }
  const line = { batchId, attempt, model: s.judgeRef, items: items.length, durationMs: Date.now() - t0, exitCode: r.exitCode, outcome, payloadSha256: sha256(payload), ...(error ? { error } : {}) };
  writeSecure(join(s.dir, "judge-calls.jsonl"), `${JSON.stringify(line)}\n`, { flag: "a" });
  return { error, parsed };
}

interface Unjudged {
  kind: string;
  caseId: string;
  retrieverId?: string;
  error: string;
}

/** A batch fails whole (retry once) or partially (retry only the missing ids once); leftovers are unjudged. */
async function judgeBatch(s: Session, batchId: string, items: JudgeItem[]): Promise<Unjudged[]> {
  let pending = items;
  let lastError = "";
  for (let attempt = 1; attempt <= 2 && pending.length; attempt++) {
    const r = await call(s, batchId, attempt, pending);
    if (!r.parsed) {
      lastError = r.error;
      continue;
    }
    const answers = r.parsed.verdicts;
    for (const it of pending) {
      const v = answers.get(it.id);
      if (v) record(s, it, v);
    }
    pending = pending.filter((it) => !answers.has(it.id));
    lastError = pending.length ? "item missing from the judge's answer" : "";
  }
  return pending.map((it) => ({ kind: it.kind, caseId: it.caseId, ...(it.retrieverId ? { retrieverId: it.retrieverId } : {}), error: lastError }));
}

/** Consent before the first remote call; returns an exit code when the run must stop. */
async function consent(ctx: Ctx, judge: ResolvedJudge, pendingCount: number, batchCount: number, yes: boolean | undefined): Promise<number | null> {
  ctx.out(`Remote call: provider ${judge.provider}, model ${judge.ref}; up to ${pendingCount} items in ${batchCount} batches.\nData sent: ${DATA_CLASSES}.\n`);
  if (yes) return null;
  if (!ctx.isTTY) {
    ctx.err("memory-eval: refusing to send case text to a model provider without consent: stdin is not a TTY; pass --yes to confirm\n");
    return 1;
  }
  if (!ctx.confirm || !(await ctx.confirm(`Send to ${judge.provider} (${judge.ref})? [y/N] `))) {
    ctx.err("memory-eval: judge declined; no call was made\n");
    return 1;
  }
  return null;
}

function helpItems(retrieved: RetrievedFile, c: Case): JudgeItem[] {
  const out: JudgeItem[] = [];
  for (const r of retrieved.retrievers) {
    const top5 = r.status === "ok" ? (retrieved.results[r.id]?.[c.id]?.top5 ?? []) : [];
    // An empty output is not helpful by construction; there is nothing to judge.
    if (top5.length) out.push(helpfulnessItem(c, r.id, outputHash(r.id, r.version, top5), top5));
  }
  return out;
}

interface Plan {
  validity: JudgeItem[];
  pendingValidity: JudgeItem[];
  pendingHelpBound: JudgeItem[];
  totalItems: number;
  pendingCount: number;
  batchCount: number;
}

function plan(s: Session, retrieved: RetrievedFile, cases: Case[]): Plan {
  const validity = cases.map(validityItem);
  const isInvalid = (c: Case) => s.verdicts.get(keyString(keyOf(s, validityItem(c))))?.verdict === "invalid";
  const pendingValidity = validity.filter((i) => !cached(s, i));
  // Upper bound before validity is known: every case not already judged invalid.
  const pendingHelpBound = cases.filter((c) => !isInvalid(c)).flatMap((c) => helpItems(retrieved, c)).filter((i) => !cached(s, i));
  const totalItems = validity.length + cases.reduce((n, c) => n + helpItems(retrieved, c).length, 0);
  const batchCount = chunk(pendingValidity, BATCH_SIZE).length + chunk(pendingHelpBound, BATCH_SIZE).length;
  return { validity, pendingValidity, pendingHelpBound, totalItems, pendingCount: pendingValidity.length + pendingHelpBound.length, batchCount };
}

function writeJudgeManifest(s: Session, manifest: RunManifest, judge: ResolvedJudge, validity: JudgeItem[]): void {
  const vs = validity.map((i) => [i.caseId, s.verdicts.get(keyString(keyOf(s, i)))?.verdict] as const).filter(([, v]) => v).sort();
  manifest.judge = { role: judge.role ?? "absent", model: judge.ref, promptVersion: s.base.promptVersion, promptSha256: s.base.promptSha256, scrubSha256: s.base.scrubSha256, validitySetHash: sha256(vs.map(([c, v]) => `${c}:${v}`).join("\n")) };
  writeSecure(join(s.dir, "manifest.json"), stableJson(manifest));
}

function openSession(ctx: Ctx, p: WorkPaths, dir: string, judge: ResolvedJudge): Session {
  const promptPath = ctx.promptPath ?? DEFAULT_PROMPT;
  const promptText = readFileSync(promptPath, "utf8");
  const rules = ctx.scrubRules ?? SCRUB_RULES;
  return {
    ctx,
    dir,
    judgeRef: judge.ref,
    promptText,
    rules,
    base: { promptVersion: promptVersionOf(promptPath), promptSha256: sha256(promptText), scrubSha256: sha256(scrubRulesFingerprint(rules)), judgeModel: judge.ref },
    verdicts: loadVerdicts(p.verdicts),
    verdictsPath: p.verdicts,
    workDir: p.root,
  };
}

export async function judgeCommand(ctx: Ctx, args: JudgeArgs = {}): Promise<number> {
  const p = resolvePaths({ cwd: ctx.cwd, home: ctx.home });
  const runId = args.run ?? latestRunId(p.runsDir);
  const dir = runDir(p.runsDir, runId);
  const retrieved = readJson<RetrievedFile>(join(dir, "retrieved.json"));
  const manifest = readJson<RunManifest>(join(dir, "manifest.json"));
  const caseSet = readCaseSet(casePath(p.casesDir, retrieved.caseSetName));
  if (caseSet.caseSetHash !== retrieved.caseSetHash) throw new CliError(`case set '${retrieved.caseSetName}' changed since run ${runId} (hash ${caseSet.caseSetHash} vs ${retrieved.caseSetHash})`);

  const judge = resolveJudge(args.judge, p.providersFile);
  const s = openSession(ctx, p, dir, judge);
  const cases = caseSet.cases;
  const pl = plan(s, retrieved, cases);

  ctx.out(`judge ${judge.role ? `${judge.role} → ` : ""}${judge.ref} on run ${runId}: ${pl.totalItems - pl.pendingCount}/${pl.totalItems} items cached, ${pl.pendingCount} pending in ${pl.batchCount} batches\n`);
  if (args.dryRun) {
    const sample = (pl.pendingValidity.length ? pl.pendingValidity : pl.pendingHelpBound).slice(0, BATCH_SIZE);
    ctx.out(`dry run — no model call. Plan: ${pl.pendingCount} items, ${pl.batchCount} batches, provider ${judge.provider}, model ${judge.ref}\n`);
    if (sample.length) ctx.out(`--- sample batch (scrubbed) ---\n${buildBatchPayload(s.promptText, sample, s.rules)}--- end sample ---\n`);
    return 0;
  }
  ensureWorkDir(p);
  if (pl.pendingCount === 0) {
    writeJudgeManifest(s, manifest, judge, pl.validity);
    ctx.out("nothing to judge: every item is cached\n");
    return 0;
  }
  const stop = await consent(ctx, judge, pl.pendingCount, pl.batchCount, args.yes);
  if (stop !== null) return stop;

  const unjudged: Unjudged[] = [];
  let n = 0;
  for (const b of chunk(pl.pendingValidity, BATCH_SIZE)) unjudged.push(...(await judgeBatch(s, `validity-${++n}`, b)));
  const helpPending = cases.filter((c) => s.verdicts.get(keyString(keyOf(s, validityItem(c))))?.verdict === "valid").flatMap((c) => helpItems(retrieved, c)).filter((i) => !cached(s, i));
  for (const b of chunk(helpPending, BATCH_SIZE)) unjudged.push(...(await judgeBatch(s, `helpfulness-${++n}`, b)));

  writeSecure(join(dir, "unjudged.jsonl"), unjudged.map((u) => JSON.stringify(u)).join("\n") + (unjudged.length ? "\n" : ""));
  writeJudgeManifest(s, manifest, judge, pl.validity);
  ctx.out(`judged: ${unjudged.length} unjudged item(s)${unjudged.length ? ` (first error: ${unjudged[0].error})` : ""}\n`);
  if (unjudged.length) ctx.err(`memory-eval: ${unjudged.length} item(s) are unjudged and excluded from every rate; re-run \`judge\` to retry them\n`);
  return 0;
}

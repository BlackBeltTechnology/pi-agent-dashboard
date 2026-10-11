/**
 * `memory-eval judge`: validity per case, helpfulness per (case, retriever
 * output); cached by content hash; consent-gated; failures yield `unjudged`.
 * See change: add-memory-eval-tier-r (design M5).
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { casePath, readCaseSet } from "./cases.js";
import { latestRunId, readJson, runDir, type RetrievedFile } from "./run.js";
import type { Ctx } from "../ctx.js";
import {
  BATCH_SIZE,
  buildBatchPayload,
  DATA_CLASSES,
  helpfulnessItem,
  JUDGE_TIMEOUT_MS,
  judgeArgs,
  type JudgeItem,
  keyString,
  outputHash,
  parseAnswer,
  promptVersionOf,
  resolveJudge,
  validityItem,
  type VerdictKey,
  type VerdictRecord,
} from "../judge.js";
import { SCRUB_RULES, scrubRulesFingerprint } from "../scrub.js";
import { CliError, sha256, stableJson } from "../util.js";
import { ensureWorkDir, resolvePaths, writeSecure } from "../workdir.js";

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
    child.stdout.on("data", (d: Buffer) => (stdout = cap(stdout, d)));
    child.stderr.on("data", (d: Buffer) => (stderr = cap(stderr, d)));
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
    child.stdin.on("error", () => {});
    child.stdin.end(input);
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

export async function judgeCommand(ctx: Ctx, args: JudgeArgs = {}): Promise<number> {
  const p = resolvePaths({ cwd: ctx.cwd, home: ctx.home });
  const runId = args.run ?? latestRunId(p.runsDir);
  const dir = runDir(p.runsDir, runId);
  const retrieved = readJson<RetrievedFile>(join(dir, "retrieved.json"));
  const manifest = readJson<Record<string, any>>(join(dir, "manifest.json"));
  const caseSet = readCaseSet(casePath(p.casesDir, retrieved.caseSetName));
  if (caseSet.caseSetHash !== retrieved.caseSetHash) throw new CliError(`case set '${retrieved.caseSetName}' changed since run ${runId} (hash ${caseSet.caseSetHash} vs ${retrieved.caseSetHash})`);

  const judge = resolveJudge(args.judge, p.providersFile);
  const promptPath = ctx.promptPath ?? DEFAULT_PROMPT;
  const promptText = readFileSync(promptPath, "utf8");
  const rules = ctx.scrubRules ?? SCRUB_RULES;
  const base = {
    promptVersion: promptVersionOf(promptPath),
    promptSha256: sha256(promptText),
    scrubSha256: sha256(scrubRulesFingerprint(rules)),
    judgeModel: judge.ref,
  };
  const keyOf = (it: JudgeItem): VerdictKey => ({ kind: it.kind, caseId: it.caseId, caseContentHash: it.caseContentHash, ...(it.outputHash ? { outputHash: it.outputHash } : {}), ...base });

  const verdicts = loadVerdicts(p.verdicts);
  const cases = caseSet.cases;
  const validity = cases.map(validityItem);
  const helpFor = (caseId: string): JudgeItem[] => {
    const c = cases.find((x) => x.id === caseId)!;
    const out: JudgeItem[] = [];
    for (const r of retrieved.retrievers) {
      if (r.status !== "ok") continue;
      const top5 = retrieved.results[r.id]?.[caseId]?.top5 ?? [];
      if (!top5.length) continue; // empty output is not helpful by construction; nothing to judge
      out.push(helpfulnessItem(c, r.id, outputHash(r.id, r.version, top5), top5));
    }
    return out;
  };

  const pendingValidity = validity.filter((i) => !verdicts.has(keyString(keyOf(i))));
  const validNow = (id: string) => verdicts.get(keyString(keyOf(validity.find((v) => v.caseId === id)!)))?.verdict;
  // Upper bound before validity is known: every case not already judged invalid.
  const pendingHelpBound = cases.filter((c) => validNow(c.id) !== "invalid").flatMap((c) => helpFor(c.id)).filter((i) => !verdicts.has(keyString(keyOf(i))));
  const totalItems = validity.length + cases.reduce((n, c) => n + helpFor(c.id).length, 0);
  const pendingCount = pendingValidity.length + pendingHelpBound.length;
  const batchCount = chunk(pendingValidity, BATCH_SIZE).length + chunk(pendingHelpBound, BATCH_SIZE).length;

  const finishManifest = () => {
    const vs = validity.map((i) => [i.caseId, verdicts.get(keyString(keyOf(i)))?.verdict]).filter(([, v]) => v).sort();
    manifest.judge = { role: judge.role ?? "absent", model: judge.ref, promptVersion: base.promptVersion, promptSha256: base.promptSha256, scrubSha256: base.scrubSha256, validitySetHash: sha256(vs.map(([c, v]) => `${c}:${v}`).join("\n")) };
    writeSecure(join(dir, "manifest.json"), stableJson(manifest));
  };

  ctx.out(`judge ${judge.role ? `${judge.role} → ` : ""}${judge.ref} on run ${runId}: ${totalItems - pendingCount}/${totalItems} items cached, ${pendingCount} pending in ${batchCount} batches\n`);

  if (args.dryRun) {
    const sampleItems = pendingValidity.length ? pendingValidity.slice(0, BATCH_SIZE) : pendingHelpBound.slice(0, BATCH_SIZE);
    ctx.out(`dry run — no model call. Plan: ${pendingCount} items, ${batchCount} batches, provider ${judge.provider}, model ${judge.ref}\n`);
    if (sampleItems.length) ctx.out(`--- sample batch (scrubbed) ---\n${buildBatchPayload(promptText, sampleItems, rules)}--- end sample ---\n`);
    return 0;
  }
  ensureWorkDir(p);
  if (pendingCount === 0) {
    finishManifest();
    ctx.out("nothing to judge: every item is cached\n");
    return 0;
  }

  // Consent: before the first remote call.
  ctx.out(`Remote call: provider ${judge.provider}, model ${judge.ref}; up to ${pendingCount} items in ${batchCount} batches.\nData sent: ${DATA_CLASSES}.\n`);
  if (!args.yes) {
    if (!ctx.isTTY) {
      ctx.err("memory-eval: refusing to send case text to a model provider without consent: stdin is not a TTY; pass --yes to confirm\n");
      return 1;
    }
    if (!ctx.confirm || !(await ctx.confirm(`Send to ${judge.provider} (${judge.ref})? [y/N] `))) {
      ctx.err("memory-eval: judge declined; no call was made\n");
      return 1;
    }
  }

  const callsLog = join(dir, "judge-calls.jsonl");
  const timeoutMs = ctx.judgeTimeoutMs ?? JUDGE_TIMEOUT_MS;
  const unjudged: Array<{ kind: string; caseId: string; retrieverId?: string; error: string }> = [];
  let batchNo = 0;

  const call = async (batchId: string, attempt: number, items: JudgeItem[]) => {
    const payload = buildBatchPayload(promptText, items, rules);
    const t0 = Date.now();
    const r = await runPi(ctx, judgeArgs(judge.ref), p.root, payload, timeoutMs);
    let outcome: "ok" | "partial" | "failed" | "timeout" | "malformed" = "ok";
    let error = "";
    let parsed: ReturnType<typeof parseAnswer> | null = null;
    if (r.timedOut) {
      outcome = "timeout";
      error = `judge call timed out after ${timeoutMs} ms`;
    } else if (r.exitCode !== 0) {
      outcome = "failed";
      error = `judge exited ${r.exitCode}: ${tail(r.stderr || r.stdout)}`;
    } else {
      parsed = parseAnswer(r.stdout, items);
      if (!parsed.ok) {
        outcome = "malformed";
        error = parsed.error;
      } else if (parsed.verdicts.size < items.length) outcome = "partial";
    }
    writeSecure(callsLog, `${JSON.stringify({ batchId, attempt, model: judge.ref, items: items.length, durationMs: Date.now() - t0, exitCode: r.exitCode, outcome, payloadSha256: sha256(payload), ...(error ? { error } : {}) })}\n`, { flag: "a" });
    return { error, parsed: parsed && parsed.ok ? parsed : null };
  };

  const record = (it: JudgeItem, v: { verdict: any; note: string }) => {
    const rec: VerdictRecord = { ...keyOf(it), ...(it.retrieverId ? { retrieverId: it.retrieverId } : {}), verdict: v.verdict, note: v.note, at: (ctx.now?.() ?? new Date()).toISOString() };
    verdicts.set(keyString(rec), rec);
    writeSecure(p.verdicts, `${JSON.stringify(rec)}\n`, { flag: "a" });
  };

  const judgeBatch = async (kind: string, items: JudgeItem[]) => {
    const batchId = `${kind}-${++batchNo}`;
    let pending = items;
    let lastError = "";
    for (let attempt = 1; attempt <= 2 && pending.length; attempt++) {
      const r = await call(batchId, attempt, pending);
      if (!r.parsed) {
        lastError = r.error; // whole-batch failure: retry the same items
        continue;
      }
      for (const it of pending) {
        const v = r.parsed.verdicts.get(it.id);
        if (v) record(it, v);
      }
      pending = pending.filter((it) => !r.parsed!.verdicts.has(it.id));
      lastError = pending.length ? "item missing from the judge's answer" : "";
    }
    for (const it of pending) unjudged.push({ kind: it.kind, caseId: it.caseId, ...(it.retrieverId ? { retrieverId: it.retrieverId } : {}), error: lastError });
  };

  for (const b of chunk(pendingValidity, BATCH_SIZE)) await judgeBatch("validity", b);
  const validCases = cases.filter((c) => validNow(c.id) === "valid");
  const helpPending = validCases.flatMap((c) => helpFor(c.id)).filter((i) => !verdicts.has(keyString(keyOf(i))));
  for (const b of chunk(helpPending, BATCH_SIZE)) await judgeBatch("helpfulness", b);

  writeSecure(join(dir, "unjudged.jsonl"), unjudged.map((u) => JSON.stringify(u)).join("\n") + (unjudged.length ? "\n" : ""));
  finishManifest();
  ctx.out(`judged: ${unjudged.length} unjudged item(s)${unjudged.length ? ` (first error: ${unjudged[0].error})` : ""}\n`);
  if (unjudged.length) ctx.err(`memory-eval: ${unjudged.length} item(s) are unjudged and excluded from every rate; re-run \`judge\` to retry them\n`);
  return 0;
}

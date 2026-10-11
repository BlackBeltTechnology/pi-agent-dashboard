/** Writes a run (retrieved.json, manifest.json, verdicts) straight from a spec, bypassing run/judge. */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Case } from "../../cases.js";
import { outputHash, type VerdictKey } from "../../judge.js";
import type { CaseResult } from "../../retriever.js";
import { stableJson } from "../../util.js";
import type { TestEnv } from "./ctx.js";
import { writeCaseSet } from "./run-fixture.js";

export interface RunSpec {
  runId: string;
  setName?: string;
  cases: Case[];
  retrievers: Array<{ id: string; version?: string; asOf?: "strict" | "none"; status?: "ok" | "unavailable" }>;
  judge?: { model: string; promptVersion?: string } | null;
  results?: (rid: string, c: Case) => Partial<CaseResult>;
  validity?: (c: Case) => "valid" | "invalid" | undefined;
  helpful?: (rid: string, c: Case) => "helpful" | "not_helpful" | undefined;
}

type Retr = { id: string; version: string; asOf: "strict" | "none"; status: "ok" | "unavailable" };

function buildResults(spec: RunSpec, retrievers: Retr[]): Record<string, Record<string, CaseResult>> {
  const results: Record<string, Record<string, CaseResult>> = {};
  for (const r of retrievers.filter((x) => x.status === "ok")) {
    results[r.id] = {};
    for (const c of spec.cases) {
      const base: CaseResult = { top5: [{ ref: `r-${c.id}`, text: `t-${c.id}` }], top10: [{ ref: `r-${c.id}` }], asOfViolations: 0, invalidHits: 0, ownSessionDropped: 0, underFill: false };
      results[r.id][c.id] = { ...base, ...(spec.results?.(r.id, c) ?? {}) };
    }
  }
  return results;
}

function writeVerdicts(env: TestEnv, spec: RunSpec, retrievers: Retr[], results: Record<string, Record<string, CaseResult>>, base: Omit<VerdictKey, "kind" | "caseId" | "caseContentHash">): void {
  const put = (k: VerdictKey, verdict: string) => appendFileSync(env.paths.verdicts, `${JSON.stringify({ ...k, verdict, note: "", at: "t" })}\n`);
  mkdirSync(env.paths.root, { recursive: true });
  const helpful = (r: Retr, c: Case) => (results[r.id][c.id].top5.length ? (spec.helpful ? spec.helpful(r.id, c) : "not_helpful") : undefined);
  for (const c of spec.cases) {
    const v = spec.validity ? spec.validity(c) : "valid";
    if (v === undefined) continue;
    put({ kind: "validity", caseId: c.id, caseContentHash: c.contentHash, ...base }, v);
    for (const r of retrievers.filter((x) => x.status === "ok")) {
      const h = helpful(r, c);
      if (h) put({ kind: "helpfulness", caseId: c.id, caseContentHash: c.contentHash, outputHash: outputHash(r.id, r.version, results[r.id][c.id].top5), ...base }, h);
    }
  }
}

export function writeRun(env: TestEnv, spec: RunSpec): { caseSetHash: string } {
  const setName = spec.setName ?? "baseline";
  const set = writeCaseSet(env, spec.cases, setName);
  const dir = join(env.paths.runsDir, spec.runId);
  mkdirSync(dir, { recursive: true });
  const retrievers: Retr[] = spec.retrievers.map((r) => ({ id: r.id, version: r.version ?? "1", asOf: r.asOf ?? "strict", status: r.status ?? "ok" }));
  const results = buildResults(spec, retrievers);
  writeFileSync(join(dir, "retrieved.json"), stableJson({ runId: spec.runId, caseSetName: setName, caseSetHash: set.caseSetHash, retrievers, results }));
  const j = spec.judge === null ? null : (spec.judge ?? { model: "judge-1" });
  const base = { promptVersion: j?.promptVersion ?? "v1", promptSha256: "p", scrubSha256: "s", judgeModel: j?.model ?? "absent" };
  const judge = j
    ? { role: "absent", model: j.model, promptVersion: base.promptVersion, promptSha256: "p", scrubSha256: "s", validitySetHash: "x" }
    : { role: "absent", model: "absent", promptVersion: "absent", promptSha256: "absent", scrubSha256: "absent", validitySetHash: "absent" };
  writeFileSync(join(dir, "manifest.json"), stableJson({ runId: spec.runId, caseSet: { name: setName, hash: set.caseSetHash }, judge }));
  if (j) writeVerdicts(env, spec, retrievers, results, base);
  return { caseSetHash: set.caseSetHash };
}

/** Writes a run (retrieved.json, manifest.json, verdicts) straight from a spec, bypassing run/judge. */
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
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

export function writeRun(env: TestEnv, spec: RunSpec): { caseSetHash: string } {
  const setName = spec.setName ?? "baseline";
  const set = writeCaseSet(env, spec.cases, setName);
  const dir = join(env.paths.runsDir, spec.runId);
  mkdirSync(dir, { recursive: true });
  const retrievers = spec.retrievers.map((r) => ({ id: r.id, version: r.version ?? "1", asOf: r.asOf ?? "strict", status: r.status ?? "ok" }));
  const results: Record<string, Record<string, CaseResult>> = {};
  for (const r of retrievers) {
    if (r.status !== "ok") continue;
    results[r.id] = {};
    for (const c of spec.cases) {
      const base: CaseResult = { top5: [{ ref: `r-${c.id}`, text: `t-${c.id}` }], top10: [{ ref: `r-${c.id}` }], asOfViolations: 0, invalidHits: 0, ownSessionDropped: 0, underFill: false };
      results[r.id][c.id] = { ...base, ...(spec.results?.(r.id, c) ?? {}) };
    }
  }
  writeFileSync(join(dir, "retrieved.json"), stableJson({ runId: spec.runId, caseSetName: setName, caseSetHash: set.caseSetHash, retrievers, results }));
  const j = spec.judge === null ? null : (spec.judge ?? { model: "judge-1" });
  const base = { promptVersion: j?.promptVersion ?? "v1", promptSha256: "p", scrubSha256: "s", judgeModel: j?.model ?? "absent" };
  writeFileSync(
    join(dir, "manifest.json"),
    stableJson({
      runId: spec.runId,
      caseSet: { name: setName, hash: set.caseSetHash },
      judge: j ? { role: "absent", model: j.model, promptVersion: base.promptVersion, promptSha256: "p", scrubSha256: "s", validitySetHash: "x" } : { role: "absent", model: "absent", promptVersion: "absent", promptSha256: "absent", scrubSha256: "absent", validitySetHash: "absent" },
    }),
  );
  if (j) {
    const put = (k: VerdictKey, verdict: string) => appendFileSync(env.paths.verdicts, `${JSON.stringify({ ...k, verdict, note: "", at: "t" })}\n`);
    mkdirSync(env.paths.root, { recursive: true });
    for (const c of spec.cases) {
      const v = spec.validity ? spec.validity(c) : "valid";
      if (v === undefined) continue;
      put({ kind: "validity", caseId: c.id, caseContentHash: c.contentHash, ...base }, v);
      for (const r of retrievers) {
        if (r.status !== "ok") continue;
        const top5 = results[r.id][c.id].top5;
        if (!top5.length) continue;
        const h = spec.helpful ? spec.helpful(r.id, c) : "not_helpful";
        if (h === undefined) continue;
        put({ kind: "helpfulness", caseId: c.id, caseContentHash: c.contentHash, outputHash: outputHash(r.id, r.version, top5), ...base }, h);
      }
    }
  }
  return { caseSetHash: set.caseSetHash };
}

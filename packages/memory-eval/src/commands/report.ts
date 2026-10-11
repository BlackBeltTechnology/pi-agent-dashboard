import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../ctx.js";
import { aggregate, compareRuns, existsRun, loadRun, renderComparison, renderReport } from "../report.js";
import { CliError } from "../util.js";
import { ensureWorkDir, resolvePaths, writeSecure } from "../workdir.js";
import { latestRunId, runDir } from "./run.js";

export interface ReportArgs {
  run?: string;
  compare?: [string, string];
  allowJudgeMismatch?: boolean;
}

export function reportCommand(ctx: Ctx, args: ReportArgs = {}): number {
  const p = resolvePaths({ cwd: ctx.cwd, home: ctx.home });
  ensureWorkDir(p);
  if (args.compare) {
    const [a, b] = args.compare;
    for (const id of [a, b]) if (!existsRun(p, id)) throw new CliError(`unknown run '${id}' in ${p.runsDir}`);
    const text = renderComparison(compareRuns(loadRun(p, a), loadRun(p, b), { allowJudgeMismatch: args.allowJudgeMismatch }));
    writeSecure(join(p.reportsDir, `compare-${a}-${b}.md`), text);
    ctx.out(text);
    return 0;
  }
  const id = args.run ?? latestRunId(p.runsDir);
  if (!existsRun(p, id)) throw new CliError(`unknown run '${id}' in ${p.runsDir}`);
  const text = renderReport(aggregate(loadRun(p, id)));
  writeSecure(join(p.reportsDir, `${id}.md`), text);
  ctx.out(text);
  return 0;
}

export function statusCommand(ctx: Ctx): number {
  const p = resolvePaths({ cwd: ctx.cwd, home: ctx.home });
  const ids = existsSync(p.runsDir) ? readdirSync(p.runsDir).sort() : [];
  if (!ids.length) {
    ctx.out(`no runs in ${p.runsDir}\n`);
    return 0;
  }
  for (const id of ids) {
    if (!existsRun(p, id)) continue;
    const run = loadRun(p, id);
    const cov = run.coverage();
    const calls = join(runDir(p.runsDir, id), "judge-calls.jsonl");
    const outcomes: Record<string, number> = {};
    if (existsSync(calls)) {
      for (const l of readFileSync(calls, "utf8").split("\n").filter(Boolean)) {
        const o = (JSON.parse(l) as { outcome?: string }).outcome ?? "unknown";
        outcomes[o] = (outcomes[o] ?? 0) + 1;
      }
    }
    const j = run.manifest.judge ?? {};
    ctx.out(
      `${id}  case-set ${run.retrieved.caseSetHash.slice(0, 16)} (${run.retrieved.caseSetName})  judge ${j.model ?? "absent"}  judged ${cov.judged}  unjudged ${cov.unjudged}  judge-calls: ${Object.keys(outcomes).length ? Object.entries(outcomes).map(([k, v]) => `${k}=${v}`).join(" ") : "none"}\n`,
    );
  }
  return 0;
}

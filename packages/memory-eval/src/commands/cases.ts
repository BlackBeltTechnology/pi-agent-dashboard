import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCaseSet, DEFAULT_SEED, type CaseSet, type Quotas } from "../cases.js";
import type { Ctx } from "../ctx.js";
import { listSessionFiles, parseSessionFiles } from "../events.js";
import { CliError, stableJson } from "../util.js";
import { ensureWorkDir, resolvePaths, writeSecure } from "../workdir.js";

export interface CasesBuildArgs {
  set?: string;
  seed?: number;
  quotas?: Partial<Quotas>;
  force?: boolean;
  includeWorktrees?: boolean;
}

export function casePath(casesDir: string, set: string): string {
  return join(casesDir, `${set}.json`);
}

export function readCaseSet(path: string): CaseSet {
  if (!existsSync(path)) throw new CliError(`case set not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as CaseSet;
}

export function casesBuild(ctx: Ctx, args: CasesBuildArgs = {}): number {
  const set = args.set ?? "baseline";
  if (!/^[\w.-]+$/.test(set)) throw new CliError(`invalid set name: ${set}`);
  const p = resolvePaths({ cwd: ctx.cwd, home: ctx.home });
  const dirs = [p.sessionsDir];
  if (args.includeWorktrees) {
    const prefix = `${p.projectKey.slice(0, -2)}-.worktrees-`;
    try {
      for (const n of readdirSync(p.sessionsRoot)) if (n.startsWith(prefix)) dirs.push(join(p.sessionsRoot, n));
    } catch {
      /* no sessions root */
    }
  }
  const files = listSessionFiles(dirs);
  if (!files.length) {
    ctx.err(`memory-eval: no session files (*.jsonl) in ${p.sessionsDir}\n`);
    return 1;
  }
  const target = casePath(p.casesDir, set);
  if (existsSync(target) && !args.force) {
    ctx.err(`memory-eval: case set '${set}' already exists (${target}); pass --force to overwrite or --set <name> for a new set\n`);
    return 1;
  }
  const caseSet = buildCaseSet(parseSessionFiles(files), { seed: args.seed ?? DEFAULT_SEED, quotas: args.quotas });
  ensureWorkDir(p);
  writeSecure(target, stableJson(caseSet));
  const c = caseSet.counts;
  ctx.out(
    `case set '${set}': ${caseSet.cases.length} cases, hash ${caseSet.caseSetHash.slice(0, 16)}\n` +
      `  candidates: ${Object.entries(c.candidates).map(([k, v]) => `${k}=${v}`).join(" ")}\n` +
      `  sampled:    ${Object.entries(c.sampled).map(([k, v]) => `${k}=${v}`).join(" ")}\n` +
      `  excluded signatures: ${caseSet.excludedSignatures}; input files: ${caseSet.inputFingerprint.files}\n`,
  );
  return 0;
}

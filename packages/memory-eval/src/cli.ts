/**
 * memory-eval CLI. `main(argv, ctx)` is the whole program; tests call it directly.
 * See change: add-memory-eval-tier-r (design M1).
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { casesBuild } from "./commands/cases.js";
import { judgeCommand } from "./commands/judge.js";
import { reportCommand, statusCommand } from "./commands/report.js";
import { runCommand } from "./commands/run.js";
import { type Ctx, defaultCtx } from "./ctx.js";
import { CliError } from "./util.js";

const HELP = `memory-eval — Tier R retrieval evaluation (local-only data)

Usage:
  memory-eval cases build [--set <name>] [--seed N] [--recurring N] [--negatives N] [--force] [--include-worktrees]
  memory-eval run [--set <name>] [--retrievers <ids>] [--retriever-module <path>] [--hermes-project <name>] [--kb-index <path>]
  memory-eval judge [--run <id>] [--judge <@role|provider/id[:thinking]>] [--yes] [--dry-run]
  memory-eval report [--run <id>] [--compare <runA> <runB>] [--allow-judge-mismatch]
  memory-eval status

Global: --project-dir <path>  project whose sessions are mined (default: cwd)
Data lives under ~/.pi/dashboard/memory-eval/<project-key>/ (mode 0700); nothing is committed.
`;

const num = (v: string | undefined, name: string): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new CliError(`${name} must be a non-negative integer`);
  return n;
};

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  "project-dir": { type: "string" },
  set: { type: "string" },
  seed: { type: "string" },
  recurring: { type: "string" },
  negatives: { type: "string" },
  force: { type: "boolean" },
  "include-worktrees": { type: "boolean" },
  retrievers: { type: "string" },
  "retriever-module": { type: "string" },
  "hermes-project": { type: "string" },
  "kb-index": { type: "string" },
  run: { type: "string" },
  judge: { type: "string" },
  yes: { type: "boolean" },
  "dry-run": { type: "boolean" },
  compare: { type: "boolean" },
  "allow-judge-mismatch": { type: "boolean" },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];

function quotas(v: Values) {
  return {
    ...(v.recurring !== undefined ? { recurring: num(v.recurring, "--recurring") as number } : {}),
    ...(v.negatives !== undefined ? { negatives: num(v.negatives, "--negatives") as number } : {}),
  };
}

function comparePair(ids: string[], wanted: boolean | undefined): [string, string] | undefined {
  if (!wanted) return undefined;
  if (ids.length !== 2) throw new CliError("usage: memory-eval report --compare <runA> <runB>");
  return [ids[0], ids[1]];
}

async function dispatch(ctx: Ctx, values: Values, positionals: string[]): Promise<number> {
  const [cmd, ...rest] = positionals;
  switch (cmd) {
    case "cases":
      if (rest[0] !== "build") throw new CliError("usage: memory-eval cases build [options]");
      return casesBuild(ctx, { set: values.set, seed: num(values.seed, "--seed"), quotas: quotas(values), force: values.force, includeWorktrees: values["include-worktrees"] });
    case "run":
      return await runCommand(ctx, {
        set: values.set,
        retrievers: values.retrievers?.split(",").map((x) => x.trim()).filter(Boolean),
        retrieverModule: values["retriever-module"],
        hermesProject: values["hermes-project"],
        kbIndex: values["kb-index"],
      });
    case "judge":
      return await judgeCommand(ctx, { run: values.run, judge: values.judge, yes: values.yes, dryRun: values["dry-run"] });
    case "report":
      return reportCommand(ctx, { run: values.run, compare: comparePair(rest, values.compare), allowJudgeMismatch: values["allow-judge-mismatch"] });
    case "status":
      return statusCommand(ctx);
    default:
      throw new CliError(`unknown command '${cmd}'\n${HELP}`);
  }
}

export async function main(argv: string[], baseCtx: Ctx = defaultCtx()): Promise<number> {
  try {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
    const ctx: Ctx = { ...baseCtx, cwd: values["project-dir"] ? resolve(values["project-dir"]) : baseCtx.cwd };
    if (values.help || !positionals.length) {
      ctx.out(HELP);
      return values.help ? 0 : 1;
    }
    return await dispatch(ctx, values, positionals);
  } catch (e) {
    if (e instanceof CliError) {
      baseCtx.err(`memory-eval: ${e.message}\n`);
      return e.code;
    }
    baseCtx.err(`memory-eval: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  process.exit(await main(process.argv.slice(2)));
}

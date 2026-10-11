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
import { defaultCtx, type Ctx } from "./ctx.js";
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

export async function main(argv: string[], baseCtx: Ctx = defaultCtx()): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
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
      },
    });
    const ctx: Ctx = { ...baseCtx, cwd: values["project-dir"] ? resolve(values["project-dir"]) : baseCtx.cwd };
    const [cmd, sub, ...rest] = positionals;
    if (values.help || !cmd) {
      ctx.out(HELP);
      return cmd || values.help ? 0 : 1;
    }
    switch (cmd) {
      case "cases":
        if (sub !== "build") throw new CliError("usage: memory-eval cases build [options]");
        return casesBuild(ctx, {
          set: values.set,
          seed: num(values.seed, "--seed"),
          quotas: { ...(values.recurring !== undefined ? { recurring: num(values.recurring, "--recurring")! } : {}), ...(values.negatives !== undefined ? { negatives: num(values.negatives, "--negatives")! } : {}) },
          force: values.force,
          includeWorktrees: values["include-worktrees"],
        });
      case "run":
        return await runCommand(ctx, {
          set: values.set,
          retrievers: values.retrievers?.split(",").map((s) => s.trim()).filter(Boolean),
          retrieverModule: values["retriever-module"],
          hermesProject: values["hermes-project"],
          kbIndex: values["kb-index"],
        });
      case "judge":
        return await judgeCommand(ctx, { run: values.run, judge: values.judge, yes: values.yes, dryRun: values["dry-run"] });
      case "report":
        return reportCommand(ctx, {
          run: values.run,
          compare: values.compare ? ((): [string, string] => {
            const ids = [sub, ...rest].filter((x): x is string => Boolean(x));
            if (ids.length !== 2) throw new CliError("usage: memory-eval report --compare <runA> <runB>");
            return [ids[0], ids[1]];
          })() : undefined,
          allowJudgeMismatch: values["allow-judge-mismatch"],
        });
      case "status":
        return statusCommand(ctx);
      default:
        void rest;
        throw new CliError(`unknown command '${cmd}'\n${HELP}`);
    }
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
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

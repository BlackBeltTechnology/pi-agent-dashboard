/**
 * ship-batch — ship a whole OpenSpec group unattended, N changes at a time.
 *
 *   npx tsx .pi/skills/ship-batch/scripts/ship-batch.ts --group <id|name> [flags]
 *
 * Exit: 0 every change shipped · 2 anything kept/incomplete/failed/skipped ·
 * 1 usage / preflight / lock / fatal · 130 / 143 on SIGINT / SIGTERM.
 *
 * All logic lives in `runner.ts` (+ the pure modules); this file only wires the
 * real adapters and the process signals.
 *
 * See change: add-ship-batch-orchestrator.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createDeps } from "./adapters.ts";
import { parseArgs } from "./args.ts";
import { installSignalHandlers, type Runner, runMain } from "./runner.ts";

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    console.error(parsed.error);
    return 1;
  }
  let runner: Runner | undefined;
  const signals = installSignalHandlers(() => runner);
  try {
    return await runMain(parsed.args, createDeps(), {
      onRunner: (r) => {
        runner = r;
        const early = signals.pending();
        if (early !== null) r.requestStop(early);
      },
    });
  } finally {
    signals.dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`ship-batch: fatal: ${(e as Error)?.stack ?? e}`);
      process.exit(1);
    },
  );
}

export { main };

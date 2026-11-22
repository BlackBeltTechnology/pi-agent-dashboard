// Child process for reindex-worker.test.ts (S64): runs ONE job through the real reindex worker and prints
// `{ chunks, changed, execArgv }`. It never calls shutdown(): the parent asserts the process exits on its own.
// argv: <runner module path> <input.json path>   See change: throttle-kb-reindex (test-plan #S64).
import { readFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";
import type { WorkerOptions } from "node:worker_threads";

const wt = createRequire(import.meta.url)("node:worker_threads") as typeof import("node:worker_threads");
const Real = wt.Worker;
const execArgvs: unknown[] = [];
(wt as { Worker: unknown }).Worker = class extends Real {
  constructor(url: string | URL, o?: WorkerOptions) {
    if (String(url).endsWith("reindex-worker.mjs")) execArgvs.push(o?.execArgv);
    super(url, o);
  }
};
syncBuiltinESMExports();

const { createReindexRunner } = await import(pathToFileURL(process.argv[2]).href);
const runner = createReindexRunner({ useWorker: () => true });
const r = await runner.run(JSON.parse(readFileSync(process.argv[3], "utf8")), {
  log: { info() {}, warn: (m: string) => process.stderr.write(`WARN ${m}\n`) },
});
process.stdout.write(`${JSON.stringify({ chunks: r.chunks, changed: r.changed, execArgv: execArgvs })}\n`);

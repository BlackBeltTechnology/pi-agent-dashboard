// Child process for query-worker-loader.test.ts (change: bound-kb-proximity-search,
// test-plan #W20, #W22, #W25): runs ONE off-thread search through a real query
// worker and prints `{ kind, hits, execArgv }`. It deliberately never calls
// `shutdown()`: the parent asserts the process still exits on its own (the
// worker and every host timer are unref()'d). argv: <dbPath>
import { createRequire, syncBuiltinESMExports } from "node:module";
import type { WorkerOptions } from "node:worker_threads";

// Record the options the host passes to `new Worker` for the query worker
// (W25: execArgv must be []). Other workers (e.g. a loader's own) are ignored.
const wt = createRequire(import.meta.url)("node:worker_threads") as typeof import("node:worker_threads");
const Real = wt.Worker;
const execArgvs: unknown[] = [];
(wt as { Worker: unknown }).Worker = class extends Real {
  constructor(url: string | URL, o?: WorkerOptions) {
    if (String(url).endsWith("query-worker.mjs")) execArgvs.push(o?.execArgv);
    super(url, o);
  }
};
syncBuiltinESMExports();

const { createQueryWorkerHost } = await import("../../query-worker-host.js");
const host = createQueryWorkerHost({ useWorker: true });
const r = await host.run({ op: "search", dbPath: process.argv[2], query: "token rotation", opts: { limit: 5 } }, {
  inProcess: () => { throw new Error("in-process fallback taken"); },
});
process.stdout.write(`${JSON.stringify({ kind: r.kind, hits: r.kind === "ok" ? (r.value as unknown[]).length : 0, execArgv: execArgvs })}\n`);

// Test worker for reindex-worker.test.ts (S55): stands in for a reindex worker that dies mid first-index.
// Writes a half-built `<db>.tmp-<pid>` (WAL, uncommitted-looking junk table), reports `ready`, then throws
// uncaught. Plain node: builtins only. See change: throttle-kb-reindex (test-plan #S55).
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";

const tmp = `${workerData.input.dbPath}.tmp-${process.pid}`;
mkdirSync(dirname(tmp), { recursive: true });
const db = new DatabaseSync(tmp);
db.exec("PRAGMA journal_mode=WAL; CREATE TABLE chunks(junk TEXT); INSERT INTO chunks VALUES ('half-built');");
parentPort.postMessage({ kind: "ready" });
setTimeout(() => {
  throw new Error("simulated worker crash mid first index");
}, 50);

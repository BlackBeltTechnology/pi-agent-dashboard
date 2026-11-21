// Test worker for reindex-worker.test.ts (S58): a worker that is "hung" inside an open write transaction
// (uncommitted WAL frames) and ignores `cancel`. Plain node: builtins only.
// See change: throttle-kb-reindex (test-plan #S58).
import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";

const db = new DatabaseSync(workerData.input.dbPath);
db.exec("PRAGMA journal_mode=WAL; BEGIN IMMEDIATE; CREATE TABLE zz_uncommitted(x TEXT);");
for (let i = 0; i < 500; i++) db.prepare("INSERT INTO zz_uncommitted VALUES (?)").run(`row-${i}`);
parentPort.on("message", () => {}); // ignores cancel; keeps the thread alive
parentPort.postMessage({ kind: "ready" });

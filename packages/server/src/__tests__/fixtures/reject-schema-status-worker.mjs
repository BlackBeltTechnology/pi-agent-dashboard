/**
 * Fixture poll worker for `workerUrlOverride`: every request is answered with a
 * worker-side error, so the pool settles it through its in-process fallback.
 * Used to exercise the `schemaStatus` worker-failure path (a plain `.mjs`
 * worker cannot load the TypeScript worker body, so `probe` / `build` take the
 * same fallback; results are identical by the worker/in-process parity rule).
 * See change: move-workflow-schema-status-to-poll-worker.
 */
import { parentPort } from "node:worker_threads";

parentPort.on("message", (msg) => {
  if (msg && msg.type === "shutdown") {
    parentPort.close();
    return;
  }
  parentPort.postMessage({ id: msg.id, ok: false, error: `fixture worker rejects ${String(msg.kind)}` });
});

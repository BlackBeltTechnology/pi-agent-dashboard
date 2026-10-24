/**
 * `worker_threads` entry for the `GET /api/grep` JS-fallback scan. Runs `grepWithJsScan`
 * off the main event loop so a caller-supplied catastrophic regex cannot stall the server;
 * the parent (`grepWithJsScanInWorker`) terminates the thread after the scan timeout.
 *
 * Bootstrap runs only when `!isMainThread`, mirroring `attachments/fit-worker.ts`.
 * Input comes through `workerData`; only the match array crosses back.
 *
 * See change: triage-codeql-alert-debt (D3, #216).
 */
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { type GrepWorkerReply, type GrepWorkerRequest, grepWithJsScan } from "./grep.js";

if (!isMainThread && parentPort) {
  const { cwd, query, opts } = workerData as GrepWorkerRequest;
  let reply: GrepWorkerReply;
  try {
    reply = { ok: true, matches: grepWithJsScan(cwd, query, opts) };
  } catch (err) {
    reply = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  parentPort.postMessage(reply);
}

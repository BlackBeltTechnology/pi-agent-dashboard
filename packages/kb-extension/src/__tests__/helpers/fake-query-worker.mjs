// Fake kb query worker for query-worker-host tests (change:
// bound-kb-proximity-search, test-plan #W1–#W19). Speaks the real protocol
// ({kind:"ready"|"load-failed"|"result"|"error"}). Ops:
//   sleepNative {ms}  — blocks the thread in a synchronous child-process wait:
//                       like a native SQLite statement, terminate() cannot
//                       interrupt it (Atomics.wait would be interrupted)
//   spin {ms}         — busy JS loop (terminate() stops it at once)
//   exit {code}       — process.exit
//   throw {message}   — op error reply
//   anything else     — immediate result { op, pid-like worker id }
// workerData (all optional):
//   readyDelayMs      — delay before `ready` (default 0)
//   never             — never post `ready`
//   readyOnAttempt    — post `ready` only on this start attempt (1-based; needs `shared`)
//   loadFailed        — post `load-failed` with this message
//   crash             — "first" (exit(1) on the first op across all workers; needs `shared`) | "always"
//   slowMs            — every op first blocks like sleepNative for this long
//   slowCount         — only the first N ops across all workers are slow (needs `shared`)
//   toolShaped        — reply `search` with [] and `fetch` with a RenderedFetch
//   shared            — SharedArrayBuffer(8): [0] start attempts, [1] ops seen
import { execFileSync } from "node:child_process";
import { parentPort, threadId, workerData } from "node:worker_threads";

const d = workerData ?? {};
const blockFor = (ms) => execFileSync(process.execPath, ["-e", `setTimeout(() => {}, ${Number(ms)})`]);
const counters = d.shared ? new Int32Array(d.shared) : null;
const attempt = counters ? Atomics.add(counters, 0, 1) + 1 : 1;

if (d.loadFailed) {
  parentPort.postMessage({ kind: "load-failed", message: d.loadFailed });
} else {
  parentPort.on("message", (m) => {
    if (m.op === "close") return;
    const seen = counters ? Atomics.add(counters, 1, 1) + 1 : 1;
    if (d.crash === "always" || (d.crash === "first" && seen === 1)) process.exit(1);
    if (d.slowMs && (d.slowCount === undefined || seen <= d.slowCount)) blockFor(d.slowMs);
    switch (m.op) {
      case "sleepNative":
        blockFor(m.ms);
        break;
      case "spin": {
        const end = Date.now() + m.ms;
        while (Date.now() < end) { /* busy */ }
        break;
      }
      case "exit":
        process.exit(m.code ?? 1);
        break;
      case "throw":
        parentPort.postMessage({ kind: "error", id: m.id, message: m.message });
        return;
    }
    if (d.toolShaped && m.op === "search") return parentPort.postMessage({ kind: "result", id: m.id, value: [] });
    if (d.toolShaped && m.op === "fetch") return parentPort.postMessage({ kind: "result", id: m.id, value: { text: "(fake fetch)", found: false, suppressedSections: 0 } });
    parentPort.postMessage({ kind: "result", id: m.id, value: { op: m.op, worker: threadId } });
  });
  const ready = d.never || (d.readyOnAttempt && attempt !== d.readyOnAttempt) ? null : (d.readyDelayMs ?? 0);
  if (ready !== null) setTimeout(() => parentPort.postMessage({ kind: "ready" }), ready);
}

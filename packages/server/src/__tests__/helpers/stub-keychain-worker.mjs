// Scripted stand-in for `credential-key-worker.mjs` (test-plan "New infra": stub keychain worker entry).
// Injected through `initCredentialKey({ workerEntry, workerData: { scripts } })`; it never loads a keychain
// binding. `workerData.scripts[job.op]` (or `.default`) is one of:
//   { mode: "answer", value: string|null, delayMs?: number, created?: boolean }
//   { mode: "hang" } | { mode: "throw" } | { mode: "exit", code?: number } | { mode: "error", detail: string }
import { parentPort, workerData } from "node:worker_threads";

const scripts = workerData?.scripts ?? {};
const script = scripts[workerData?.job?.op] ?? scripts.default ?? { mode: "hang" };

switch (script.mode) {
  case "throw":
    throw new Error("stub worker failed to load");
  case "exit":
    process.exit(script.code ?? 0);
    break;
  case "error":
    parentPort.postMessage({ ok: false, stage: "load", detail: script.detail });
    break;
  case "answer":
    setTimeout(() => parentPort.postMessage({ ok: true, value: script.value ?? null, created: Boolean(script.created) }), script.delayMs ?? 0);
    break;
  default:
    // hang: keep the thread alive, never answer (an open unlock prompt)
    setInterval(() => {}, 1000);
}

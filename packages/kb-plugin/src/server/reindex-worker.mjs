// Plain-JS bootstrap + body of the kb reindex worker thread (change: throttle-kb-reindex, design D3).
// A worker starts a fresh module graph without the server's native TS loader, and the kb sources are
// TypeScript with `.js`-suffixed relative imports, so this file registers the shared per-thread
// `module.registerHooks` pair (the same hooks the native loader uses: `.js`→`.ts` resolve retry,
// strip-mode `.ts` load, also under node_modules) BEFORE importing `reindex-core.ts`. Hooks registered with
// `registerHooks` are per-thread: they never stack on the server's own loader.
// Protocol (host: reindex-runner.ts): posts `ready` (or `load-failed` — the host then runs the job
// in-process), then `progress` (coalesced ≥ 250 ms) / `log`, and finally exactly one of `result` | `error`
// | `cancelled`. A `{kind:"cancel"}` message aborts the pass at its next yield.
import nodeModule from "node:module";
import { parentPort, workerData } from "node:worker_threads";

// Worker stderr is piped into the server's: silence exactly the expected ExperimentalWarning from sqlite.
const originalEmitWarning = process.emitWarning;
process.emitWarning = function emitWarning(warning, ...rest) {
  const msg = typeof warning === "string" ? warning : warning?.message;
  if (typeof msg === "string" && msg.startsWith("SQLite is an experimental feature")) return;
  return originalEmitWarning.call(process, warning, ...rest);
};

const post = (m) => parentPort.postMessage(m);
// stdio travels to the server on its own channel: flush it before the terminal message so the core's own
// stderr lines (`[kb] seed=…`, `[kb] install=…`) are delivered before the job settles.
const flushStdio = () => Promise.all([process.stdout, process.stderr].map((s) => new Promise((r) => s.write("", r))));
const controller = new AbortController();
parentPort.on("message", (m) => {
  if (m?.kind === "cancel") controller.abort();
});

let core;
try {
  if (typeof nodeModule.registerHooks !== "function") throw new Error(`node ${process.version} lacks module.registerHooks`);
  const { resolveSync, loadSync } = await import("@blackbelt-technology/pi-dashboard-shared/platform/native-ts-hooks.mjs");
  nodeModule.registerHooks({ resolve: resolveSync, load: loadSync });
  core = await import("./reindex-core.ts");
} catch (err) {
  post({ kind: "load-failed", message: String(err?.message ?? err).split("\n")[0] });
  parentPort.close();
}

if (core) {
  post({ kind: "ready" });
  try {
    const value = await core.runReindexCore(workerData.input, {
      signal: controller.signal,
      log: {
        info: (message) => post({ kind: "log", level: "info", message }),
        warn: (message) => post({ kind: "log", level: "warn", message }),
      },
      onProgress: core.coalesceProgress((progress) => post({ kind: "progress", progress })),
    });
    await flushStdio();
    post({ kind: "result", value });
  } catch (err) {
    await flushStdio();
    if (controller.signal.aborted || err?.name === "KbIndexAborted") post({ kind: "cancelled" });
    else post({ kind: "error", message: String(err?.message ?? err) });
  }
  parentPort.close(); // nothing left to listen for: let the thread end on its own (exit code 0)
}

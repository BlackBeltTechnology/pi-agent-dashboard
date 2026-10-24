// worker_threads bootstrap that poses as a classic WorkerGlobalScope for the published browser
// `st` Blender runtime (session-worker.js + blender.js glue), inside plain Node.
//
// Sandbox shape (design D1): `process` is deleted so the Emscripten glue takes its browser/worker
// branch (no Node fs/net); `fetch` rejects; every network constructor is deleted BEFORE the glue
// loads, which makes any Python `socket.connect` fail with OSError (measured); `importScripts`
// reads files only from the runtime directory. Plain CommonJS on purpose: it runs unbundled.
//
// See change: add-blender-wasm-mcp (design D1, task 3.2).
"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");
const fs = require("node:fs");

const url = String(workerData.url);
// The runtime directory URL (ends with "/"): every read must stay inside it.
const runtimeDir = new URL(".", url).href;

function readInsideRuntime(raw) {
  const target = new URL(raw, url);
  if (target.protocol !== "file:" || !target.href.startsWith(runtimeDir)) {
    throw new Error(`blender worker may only read from the runtime directory: ${target.href}`);
  }
  return { href: target.href, text: fs.readFileSync(target, "utf8") };
}

globalThis.fetch = () => Promise.reject(new TypeError("network disabled in blender worker"));
for (const name of ["WebSocket", "EventSource", "XMLHttpRequest", "WebSocketStream"]) {
  try {
    delete globalThis[name];
  } catch {
    /* non-configurable on this Node: the host-level guard test would catch it */
  }
}
delete globalThis.process; // ENVIRONMENT_IS_NODE → false in the glue
globalThis.WorkerGlobalScope = function WorkerGlobalScope() {};
globalThis.self = globalThis;
globalThis.location = new URL(url);
globalThis.importScripts = (...urls) => {
  for (const u of urls) {
    const { href, text } = readInsideRuntime(u);
    vm.runInThisContext(text, { filename: href });
  }
};
globalThis.postMessage = (data, transfer) =>
  parentPort.postMessage(data, transfer ? transfer.filter((t) => t instanceof ArrayBuffer) : undefined);
parentPort.on("message", (data) => {
  if (typeof globalThis.onmessage === "function") globalThis.onmessage({ data });
});

importScripts(url);

// Plain-JS bootstrap of the kb query worker thread (change:
// bound-kb-proximity-search, design D7). A worker starts a fresh module graph
// without pi's jiti, and the kb sources are TypeScript with `.js`-suffixed
// relative imports, so this file installs minimal in-thread hooks:
//  - resolve: Node first; only on not-found for a relative/file: `.js`
//    specifier, retry it as `.ts`. Bare specifiers are never rewritten.
//  - load: every `.ts` is read, type-stripped (strip mode) and short-circuited,
//    also under node_modules where Node refuses native stripping.
// Contract follows packages/shared/src/platform/native-ts-hooks.mjs
// (kb-extension does not depend on pi-dashboard-shared). Hooks registered with
// `module.registerHooks` are per-thread: they never touch the session thread.
// Posts `{kind:"ready"}` or `{kind:"load-failed", message}` exactly once.
import { readFileSync } from "node:fs";
import nodeModule from "node:module";
import { fileURLToPath } from "node:url";
import { parentPort } from "node:worker_threads";

// Worker stderr is piped into the pi TUI: silence exactly the two expected
// ExperimentalWarnings; every other warning still reaches stderr.
const SILENCED = ["stripTypeScriptTypes is an experimental feature", "SQLite is an experimental feature"];
const originalEmitWarning = process.emitWarning;
process.emitWarning = function emitWarning(warning, ...rest) {
  const msg = typeof warning === "string" ? warning : warning?.message;
  if (typeof msg === "string" && SILENCED.some((s) => msg.startsWith(s))) return;
  return originalEmitWarning.call(process, warning, ...rest);
};

const isRelativeOrFile = (s) => s.startsWith("./") || s.startsWith("../") || s.startsWith("/") || s.startsWith("file:");

function main() {
  if (typeof nodeModule.registerHooks !== "function" || typeof nodeModule.stripTypeScriptTypes !== "function") {
    throw new Error(`node ${process.version} lacks module.registerHooks/stripTypeScriptTypes`);
  }
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (err) {
        if (err?.code !== "ERR_MODULE_NOT_FOUND" || !isRelativeOrFile(specifier) || !specifier.endsWith(".js")) throw err;
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
    },
    load(url, context, nextLoad) {
      if (!url.startsWith("file:") || !url.endsWith(".ts")) return nextLoad(url, context);
      const source = nodeModule.stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "strip" });
      return { format: "module", source, shortCircuit: true };
    },
  });
}

let entry;
try {
  main();
  entry = await import("./query-worker-entry.ts");
} catch (err) {
  parentPort.postMessage({ kind: "load-failed", message: String(err?.message ?? err).split("\n")[0] });
}

if (entry) {
  parentPort.on("message", (msg) => {
    if (msg?.op === "close") {
      entry.close(msg.dbPath);
      return;
    }
    try {
      parentPort.postMessage({ kind: "result", id: msg.id, value: entry.handle(msg) });
    } catch (err) {
      parentPort.postMessage({ kind: "error", id: msg.id, message: String(err?.message ?? err) });
    }
  });
  parentPort.postMessage({ kind: "ready" });
}

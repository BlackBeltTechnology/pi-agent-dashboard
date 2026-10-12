// resolve/load hooks for the Node-native TypeScript loader, registered by
// `native-ts-register.mjs`. STRIP-ONLY: types are erased to whitespace, so
// line/column numbers stay exact and no source map is needed. Non-erasable
// syntax (enum, parameter properties, runtime namespace) fails loudly with the
// file path; there is no transpiling fallback.
//
// One resolve/load core, two registrations (design D4):
//  - tier 1: `module.registerHooks` — `resolveSync` / `loadSync` run in-thread.
//  - tiers 2/3: `module.register` — `resolve` / `load` wrap the same helpers
//    as async hooks off-thread; `initialize({ tier })` picks the stripper.
//
//  - resolve: Node first. Only on a not-found / dir-import failure for a
//    relative or file: specifier, retry `.js→.ts`, `.mjs→.mts`, `.cjs→.cts`;
//    an extensionless specifier tries `.ts .js .mjs /index.ts /index.js`.
//    Bare specifiers are never rewritten. Attribute-less JSON imports get
//    `type: "json"` here (in `load` it is too late — ERR_IMPORT_ATTRIBUTE_MISSING).
//    CommonJS `require()` reports MODULE_NOT_FOUND, so it never takes the retry.
//  - load: every .ts/.mts/.cts is stripped and short-circuited, so it also
//    loads under node_modules where Node refuses native stripping.
//    `.cts` → commonjs, else module.
// See change: fix-appimage-cold-boot-latency (design D3);
//             strip-only-native-ts-loader (design D4).
import { readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import nodeModule, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// `stripTypeScriptTypes` emits an ExperimentalWarning, from whichever thread
// strips (the main thread on tier 1, the hooks thread on tiers 2/3). Silence
// only that warning; every other warning still reaches stderr.
const originalEmitWarning = process.emitWarning;
process.emitWarning = function emitWarning(warning, ...rest) {
  const msg = typeof warning === "string" ? warning : warning?.message;
  if (typeof msg === "string" && msg.startsWith("stripTypeScriptTypes is an experimental feature")) return;
  return originalEmitWarning.call(process, warning, ...rest);
};

const TS_RE = /\.(m|c)?ts$/;
const JS_RE = /\.(m|c)?js$/;
const EXT_RE = /\.[a-z0-9]+$/i;
const EXTENSIONLESS_CANDIDATES = [".ts", ".js", ".mjs", "/index.ts", "/index.js"];

// Stripper. Native `stripTypeScriptTypes` by default; tier 3 (Node 23.0-23.1,
// which has no such API) swaps in the bundled `amaro`, loaded lazily so no
// other line ever reads it.
let stripper = (source, url) => nodeModule.stripTypeScriptTypes(source, { mode: "strip", sourceUrl: url });

function amaroStripper() {
  const { transformSync } = createRequire(import.meta.url)("amaro");
  return (source, url) => transformSync(source, { mode: "strip-only", filename: fileURLToPath(url) }).code;
}

/** Hooks-thread init for `module.register` (tiers 2/3); tier 3 uses amaro. */
export function initialize(data) {
  if (data?.tier === 3) stripper = amaroStripper();
}

function isFile(url) {
  try {
    return statSync(fileURLToPath(url)).isFile();
  } catch {
    return false;
  }
}

function isRelativeOrFile(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/") ||
    specifier === "." || specifier === ".." || specifier.startsWith("file:");
}

function withJsonAttribute(result) {
  if (result?.url?.startsWith("file:") && result.url.endsWith(".json") && !result.importAttributes?.type) {
    return { ...result, importAttributes: { ...result.importAttributes, type: "json" } };
  }
  return result;
}

function isRetryable(err) {
  return err?.code === "ERR_MODULE_NOT_FOUND" || err?.code === "ERR_UNSUPPORTED_DIR_IMPORT";
}

/** Candidate URLs to retry after a not-found, or `[]` when the specifier is not eligible. */
function retryUrls(specifier, parent) {
  if (!isRelativeOrFile(specifier) || !parent?.startsWith("file:")) return [];
  const candidates = [];
  if (JS_RE.test(specifier)) {
    candidates.push(specifier.replace(/\.js$/, ".ts").replace(/\.mjs$/, ".mts").replace(/\.cjs$/, ".cts"));
  } else if (!EXT_RE.test(specifier)) {
    const base = specifier.replace(/\/$/, "");
    for (const ext of EXTENSIONLESS_CANDIDATES) candidates.push(base + ext);
  }
  return candidates.map((c) => new URL(c, parent)).filter(isFile).map((u) => u.href);
}

function stripTs(source, url) {
  try {
    return stripper(source, url);
  } catch (err) {
    const wrapped = new Error(`pi-dashboard native TS loader: cannot strip types from ${fileURLToPath(url)}: ${err?.message ?? err}`);
    wrapped.code = err?.code;
    wrapped.cause = err;
    throw wrapped;
  }
}

const isTsUrl = (url) => url.startsWith("file:") && TS_RE.test(url);
const tsResult = (url, code) => ({ format: url.endsWith(".cts") ? "commonjs" : "module", source: code, shortCircuit: true });

// ── tier 1: synchronous, in-thread (`module.registerHooks`) ─────────────────

export function resolveSync(specifier, context, nextResolve) {
  try {
    return withJsonAttribute(nextResolve(specifier, context));
  } catch (err) {
    if (!isRetryable(err)) throw err;
    const [url] = retryUrls(specifier, context.parentURL);
    if (!url) throw err;
    return withJsonAttribute(nextResolve(url, context));
  }
}

export function loadSync(url, context, nextLoad) {
  if (!isTsUrl(url)) return nextLoad(url, context);
  return tsResult(url, stripTs(readFileSync(fileURLToPath(url), "utf8"), url));
}

// ── tiers 2/3: async, off-thread (`module.register`) ────────────────────────

export async function resolve(specifier, context, nextResolve) {
  try {
    return withJsonAttribute(await nextResolve(specifier, context));
  } catch (err) {
    if (!isRetryable(err)) throw err;
    const [url] = retryUrls(specifier, context.parentURL);
    if (!url) throw err;
    return withJsonAttribute(await nextResolve(url, context));
  }
}

export async function load(url, context, nextLoad) {
  if (!isTsUrl(url)) return nextLoad(url, context);
  return tsResult(url, stripTs(await readFile(fileURLToPath(url), "utf8"), url));
}

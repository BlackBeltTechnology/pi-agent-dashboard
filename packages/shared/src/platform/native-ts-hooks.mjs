// resolve/load hooks for the Node-native TypeScript loader, registered by
// `native-ts-register.mjs`.
//  - resolve: Node first. Only on a not-found / dir-import failure for a
//    relative or file: specifier, retry `.js→.ts`, `.mjs→.mts`, `.cjs→.cts`;
//    an extensionless specifier tries `.ts .js .mjs /index.ts /index.js`.
//    Bare specifiers are never rewritten. Attribute-less JSON imports get
//    `type: "json"` here (in `load` it is too late — ERR_IMPORT_ATTRIBUTE_MISSING).
//  - load: every .ts/.mts/.cts goes through `stripTypeScriptTypes` in
//    `transform` mode (enums, parameter properties, namespaces) and is
//    short-circuited, so it also loads under node_modules where Node refuses
//    native stripping. `.cts` → commonjs, else module.
// See change: fix-appimage-cold-boot-latency (design D3).
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import nodeModule from "node:module";
import { fileURLToPath } from "node:url";

// `stripTypeScriptTypes` emits an ExperimentalWarning on some Node lines, from
// this hooks thread. Silence only that warning; every other warning still
// reaches stderr.
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

export async function resolve(specifier, context, nextResolve) {
  try {
    return withJsonAttribute(await nextResolve(specifier, context));
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND" && err?.code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw err;
    const parent = context.parentURL;
    if (!isRelativeOrFile(specifier) || !parent?.startsWith("file:")) throw err;
    const candidates = [];
    if (JS_RE.test(specifier)) {
      candidates.push(specifier.replace(/\.js$/, ".ts").replace(/\.mjs$/, ".mts").replace(/\.cjs$/, ".cts"));
    } else if (!EXT_RE.test(specifier)) {
      const base = specifier.replace(/\/$/, "");
      for (const ext of EXTENSIONLESS_CANDIDATES) candidates.push(base + ext);
    }
    for (const candidate of candidates) {
      const url = new URL(candidate, parent);
      if (isFile(url)) return withJsonAttribute(await nextResolve(url.href, context));
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && TS_RE.test(url)) {
    const source = await readFile(fileURLToPath(url), "utf8");
    let code;
    try {
      code = nodeModule.stripTypeScriptTypes(source, { mode: "transform", sourceUrl: url });
    } catch (err) {
      const wrapped = new Error(`pi-dashboard native TS loader: cannot transform ${fileURLToPath(url)}: ${err?.message ?? err}`);
      wrapped.code = err?.code;
      wrapped.cause = err;
      throw wrapped;
    }
    return { format: url.endsWith(".cts") ? "commonjs" : "module", source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}

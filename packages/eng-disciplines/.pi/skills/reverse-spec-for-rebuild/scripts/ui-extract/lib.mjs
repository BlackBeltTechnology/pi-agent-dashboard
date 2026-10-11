// Shared helpers for the UI-extraction programs of reverse-spec-for-rebuild (dependency-free, Node >= 20).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Stack adapter by built-in name (adapters/<name>.mjs) or by file path (a project's own adapter).
 * A profile may declare `parent: "<adapter>"`: it is merged over that adapter, `dialect` key-wise.
 * Throws "unknown adapter <x>" when neither exists; CLIs report it and exit 2.
 */
export async function loadAdapter(nameOrPath, seen = new Set()) {
  const isPath = /[\\/]|\.m?js$/.test(nameOrPath);
  const file = isPath ? resolve(nameOrPath) : join(dirname(fileURLToPath(import.meta.url)), "adapters", `${nameOrPath}.mjs`);
  if (!existsSync(file)) throw new Error(`unknown adapter ${nameOrPath} (built-in name or path to an adapter .mjs)`);
  if (seen.has(file)) throw new Error(`adapter ${nameOrPath}: parent cycle`);
  seen.add(file);
  const mod = { ...(await import(pathToFileURL(file).href)) };
  if (!mod.parent) return mod;
  const base = await loadAdapter(mod.parent, seen);
  return { ...base, ...mod, dialect: { ...(base.dialect ?? {}), ...(mod.dialect ?? {}) } };
}

/** CLI helper: load the adapter or print the reason and exit 2. */
export async function adapterOrExit(nameOrPath) {
  try {
    const adapter = await loadAdapter(nameOrPath);
    if (adapter.encoding) setLegacyEncoding(adapter.encoding);
    return adapter;
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }
}

/**
 * Action trigger kinds (stack-neutral): user gestures, toolbar / menu items, dialog buttons,
 * keys, and `auto` (timers, watchers, load). Framework attribute names map onto these.
 */
export const TRIGGER_KINDS = new Set([
  "click", "dblclick", "change", "select", "submit", "toolbar", "menu", "context-menu", "modal-button", "key",
  "auto", "load", "timer", "focus", "blur", "drag", "drop", "wheel",
  "mousedown", "mouseup", "mousemove", "mouseenter", "mouseleave", "ifml",
]);

let LEGACY = "windows-1252";
/** Legacy code page for sources that are neither UTF-16 (BOM) nor valid UTF-8 (adapter `encoding`). */
export function setLegacyEncoding(enc) {
  new TextDecoder(enc); // throws on an unknown label
  LEGACY = enc;
}

/** Decode bytes: UTF-16 by BOM, UTF-8 when valid (BOM stripped), else as the legacy code page. */
export function decode(buf, legacy = LEGACY) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(buf.subarray(2)), encoding: "utf-16le" };
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(buf.subarray(2)), encoding: "utf-16be" };
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return { text: s.replace(/^\uFEFF/, ""), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder(legacy).decode(buf), encoding: legacy };
  }
}

export const readText = (file) => decode(readFileSync(file)).text;

/** Recursively list files under dir whose name matches re (sorted, relative to root). */
export function listFiles(root, dir, re, skip = /^(node_modules|\.git)$/) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        if (!skip.test(name)) walk(p);
      } else if (re.test(name)) out.push(relative(root, p));
    }
  };
  walk(join(root, dir));
  return out;
}

/** Index just past a string literal whose body starts at i (escapes skipped; a newline ends non-template strings). */
function quotedEnd(src, i, quote) {
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    i++;
    if (c === quote || (c === "\n" && quote !== "`")) return i;
  }
  return src.length;
}

/** Index just past a comment starting at i (`//` ends before its newline). */
function commentEnd(src, i, kind) {
  const end = kind === "/" ? src.indexOf("\n", i) : src.indexOf("*/", i + 2);
  if (end < 0) return src.length;
  return kind === "/" ? end : end + 2;
}

/** Blank out JS comments, keeping newlines so line numbers stay valid. */
export function stripJsComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && (n === "/" || n === "*")) {
      const end = commentEnd(src, i, n);
      // line comments vanish up to the newline; block comments are blanked
      if (n === "*") out += src.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
    } else if (c === '"' || c === "'" || c === "`") {
      const stop = quotedEnd(src, i + 1, c);
      out += src.slice(i, stop);
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Blank out HTML comments; JS comments inside <script> blocks too. */
export function stripHtmlComments(src) {
  const blank = (s) => s.replace(/[^\n]/g, " ");
  return src
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_, a, body, b) => a + stripJsComments(body) + b);
}

export const lineAt = (src, index) => src.slice(0, index).split("\n").length;

export const snippet = (src, index) => {
  const start = src.lastIndexOf("\n", index) + 1;
  const end = src.indexOf("\n", index);
  return src.slice(start, end < 0 ? undefined : end).trim().slice(0, 160);
};

/** Parse "file:line" or "file:a-b" cite. */
export function parseCite(cite) {
  const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(cite.trim());
  return m ? { file: m[1], from: +m[2], to: +(m[3] ?? m[2]) } : null;
}

// ---------- config merge (profiles reproduce the app merge without running app code) ----------

/** Own-key guard as lodash's safeGet: never walk into a prototype. */
const UNSAFE = (obj, key) => key === "__proto__" || (key === "constructor" && typeof obj[key] === "function");
const isObj = (v) => v !== null && typeof v === "object";

/** lodash `_.defaultsDeep` semantics on JSON-like data: fill undefined keys only, recurse into objects/arrays index-wise. */
export function defaultsDeep(target, ...sources) {
  const fill = (t, src) => {
    for (const k of Object.keys(src)) {
      if (UNSAFE(t, k) || UNSAFE(src, k)) continue;
      if (t[k] === undefined) Object.defineProperty(t, k, { value: structuredClone(src[k]), enumerable: true, writable: true, configurable: true });
      else if (isObj(t[k]) && isObj(src[k])) fill(t[k], src[k]);
    }
  };
  for (const src of sources) if (isObj(src)) fill(target, src);
  return target;
}

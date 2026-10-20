/**
 * Static origin scan: the external origins a served HTML document references in
 * its markup, so the viewer can offer them before the page runs.
 *
 * Reads `src`, `srcset`, `poster` and `data` attributes (any tag), `href` on
 * `<link>` / `<image>` / `<use>` (a plain `<a href>` is a navigation, not a load),
 * inline-`style` and `<style>` `url()` / `@import`, and the same-root stylesheets a
 * `<link rel=stylesheet>` or `@import` points at (relative references only, resolved
 * inside the real root, name-checked like a served request). Everything is a linear
 * pass over bounded input — the document is cut at 2 MiB (`incomplete`), stylesheets
 * at 512 KiB each, 16 stylesheets in all.
 *
 * Root-absolute references (`/app.js`) cannot resolve under a capability prefix and set
 * `rootAbsolute`. Origins come back canonical (https via `canonicalHttpsOrigin`;
 * an `http:` origin is listed as-is, it is simply never grantable).
 *
 * See change: improve-canvas-html-and-url-ux (design D6, task 2.7).
 */
import fs from "node:fs";
import path from "node:path";
import { isStaticWebAsset } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import { canonicalHttpsOrigin } from "@blackbelt-technology/pi-dashboard-shared/preview-egress.js";
import { safeSegments } from "./live-static.js";

export const SCAN_MAX_HTML_BYTES = 2 * 1024 * 1024;
const SCAN_MAX_CSS_BYTES = 512 * 1024;
const SCAN_MAX_CSS_FILES = 16;
const SCAN_MAX_CSS_DEPTH = 3;
/** Origins one scan may report (the per-token blocked set is bounded at 64 anyway). */
const SCAN_MAX_ORIGINS = 64;

interface ScanResult {
  /** Canonical external origins found, in first-seen order. */
  origins: string[];
  /** The document or a stylesheet was truncated, unreadable or over a bound. */
  incomplete: boolean;
  /** A root-absolute reference (`/x.js`) cannot resolve under the capability prefix. */
  rootAbsolute: boolean;
}

/** What one markup/CSS text pass yields before stylesheets are followed. */
interface TextRefs {
  origins: Set<string>;
  /** Relative same-root stylesheet references, as written. */
  stylesheets: string[];
  rootAbsolute: boolean;
}

const COMMENT = /<!--[\s\S]*?-->/g;
const TAG = /<([a-zA-Z][\w:-]*)\b([^>]*)>/g;
const ATTR = /([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"]+))\s*\)/gi;
const CSS_IMPORT = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)')/gi;
const HREF_TAGS = new Set(["link", "image", "use"]);
const SRC_ATTRS = new Set(["src", "poster", "data"]);

const decodeEntities = (s: string): string => s.replace(/&amp;/gi, "&").replace(/&#x2f;/gi, "/").replace(/&#47;/g, "/");

/**
 * Classify one reference: an external origin, a root-absolute path, or neither
 * (relative, `data:`, `blob:`, fragment, …).
 */
function classifyRef(raw: string): { origin?: string; rootAbsolute?: boolean } {
  const ref = decodeEntities(raw.trim());
  if (!ref) return {};
  if (ref.startsWith("//")) {
    const origin = canonicalHttpsOrigin(`https:${ref}`);
    return origin ? { origin } : {};
  }
  if (ref.startsWith("/")) return { rootAbsolute: true };
  const m = /^(https?):\/\//i.exec(ref);
  if (!m) return {};
  try {
    const u = new URL(ref);
    if (u.protocol === "https:") {
      const origin = canonicalHttpsOrigin(ref);
      return origin ? { origin } : {};
    }
    return { origin: u.origin };
  } catch {
    return {};
  }
}

function addRef(refs: TextRefs, raw: string): void {
  const c = classifyRef(raw);
  if (c.origin) refs.origins.add(c.origin);
  else if (c.rootAbsolute) refs.rootAbsolute = true;
}

/** Add every `url(...)` and `@import` target of a CSS text (a `<style>` block, an inline style or a stylesheet). */
function scanCssText(css: string, refs: TextRefs, followable: boolean): void {
  for (const m of css.matchAll(CSS_URL)) {
    const v = m[1] ?? m[2] ?? m[3] ?? "";
    if (v && !/^data:/i.test(v)) addRef(refs, v);
  }
  for (const m of css.matchAll(CSS_IMPORT)) {
    const v = m[1] ?? m[2] ?? "";
    if (!v) continue;
    addRef(refs, v);
    if (followable && isRelativeRef(v)) refs.stylesheets.push(v);
  }
}

/** A reference that stays inside the root (no scheme, not root-absolute / protocol-relative). */
const isRelativeRef = (ref: string): boolean => {
  const r = decodeEntities(ref.trim());
  return r !== "" && !r.startsWith("/") && !r.startsWith("#") && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(r);
};

/** Add the references of one attribute (`srcset` / `src` / `poster` / `data` / inline `style`); `href` is the caller's. */
function scanAttribute(refs: TextRefs, attr: string, value: string): void {
  if (attr === "srcset") {
    for (const cand of value.split(",")) {
      const url = cand.trim().split(/\s+/)[0];
      if (url && !/^data:/i.test(url)) addRef(refs, url);
    }
  } else if (SRC_ATTRS.has(attr)) {
    if (!/^data:/i.test(value)) addRef(refs, value);
  } else if (attr === "style") {
    scanCssText(value, refs, false);
  }
}

/** One opening tag: its attribute references, and a `<link rel=stylesheet href>` to follow. */
function scanTag(refs: TextRefs, name: string, attrs: string): void {
  let rel = "";
  const hrefs: string[] = [];
  for (const a of attrs.matchAll(ATTR)) {
    const attr = a[1].toLowerCase();
    const value = a[2] ?? a[3] ?? a[4] ?? "";
    if (attr === "rel") rel = value.toLowerCase();
    else if (attr === "href" && HREF_TAGS.has(name)) hrefs.push(value);
    else scanAttribute(refs, attr, value);
  }
  const stylesheet = name === "link" && rel.split(/\s+/).includes("stylesheet");
  for (const href of hrefs) {
    addRef(refs, href);
    if (stylesheet && isRelativeRef(href)) refs.stylesheets.push(href);
  }
}

/** Pure pass over a markup text. */
export function scanMarkup(html: string): TextRefs {
  const refs: TextRefs = { origins: new Set(), stylesheets: [], rootAbsolute: false };
  const text = html.replace(COMMENT, "");
  for (const tag of text.matchAll(TAG)) scanTag(refs, tag[1].toLowerCase(), tag[2]);
  for (const block of text.matchAll(STYLE_BLOCK)) scanCssText(block[1], refs, true);
  return refs;
}

/** Read at most `max` bytes of `file`; `truncated` when the file is larger. */
async function readCapped(file: string, max: number): Promise<{ text: string; truncated: boolean } | null> {
  let fh: fs.promises.FileHandle | undefined;
  try {
    fh = await fs.promises.open(file, "r");
    const st = await fh.stat();
    if (!st.isFile()) return null;
    const len = Math.min(st.size, max);
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, 0);
    return { text: buf.subarray(0, bytesRead).toString("utf8"), truncated: st.size > max };
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

/** Resolve a relative stylesheet reference against `fromFile` to a servable real path inside `realRoot`, or `null`. */
async function resolveStylesheet(realRoot: string, fromFile: string, ref: string): Promise<string | null> {
  const clean = decodeEntities(ref.trim()).split(/[?#]/)[0];
  if (!clean || !/\.css$/i.test(clean)) return null;
  const joined = path.resolve(path.dirname(fromFile), clean);
  const rel = path.relative(realRoot, joined);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  // Same name rules as a served request (dot dirs, node_modules, credential names, allowlist).
  const segments = safeSegments(`/${rel.split(path.sep).map(encodeURIComponent).join("/")}`);
  if (!segments || !isStaticWebAsset(segments[segments.length - 1])) return null;
  try {
    const real = await fs.promises.realpath(joined);
    const back = path.relative(realRoot, real);
    return back === "" || back.startsWith("..") || path.isAbsolute(back) ? null : real;
  } catch {
    return null;
  }
}

/** A file the scan depended on: re-stat these to know whether a cached result is still valid. */
interface ScanDependency {
  file: string;
  mtimeMs: number;
  size: number;
}

export interface ScanOutcome extends ScanResult {
  dependencies: ScanDependency[];
}

const statDep = async (file: string): Promise<ScanDependency | null> => {
  try {
    const st = await fs.promises.stat(file);
    return { file, mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
};

/** Mutable state of one scan (`origins` shared by the document and every stylesheet). */
interface ScanRun {
  realRoot: string;
  origins: Set<string>;
  out: ScanOutcome;
  seen: Set<string>;
}

/** Read one stylesheet, add its origins, and return the `@import`s to follow next. */
async function scanStylesheet(run: ScanRun, from: string, ref: string): Promise<string[] | null> {
  const real = await resolveStylesheet(run.realRoot, from, ref);
  if (!real || run.seen.has(real)) return null;
  if (run.seen.size >= SCAN_MAX_CSS_FILES) {
    run.out.incomplete = true;
    return null;
  }
  run.seen.add(real);
  const dep = await statDep(real);
  if (dep) run.out.dependencies.push(dep);
  const css = await readCapped(real, SCAN_MAX_CSS_BYTES);
  if (!css) {
    run.out.incomplete = true;
    return null;
  }
  if (css.truncated) run.out.incomplete = true;
  const refs: TextRefs = { origins: run.origins, stylesheets: [], rootAbsolute: false };
  scanCssText(css.text, refs, true);
  if (refs.rootAbsolute) run.out.rootAbsolute = true;
  return refs.stylesheets.map((r) => `${real}\u0000${r}`);
}

/** Breadth-first over same-root stylesheets, bounded in count and depth. */
async function followStylesheets(run: ScanRun, htmlFile: string, first: string[]): Promise<void> {
  let queue: Array<{ from: string; ref: string }> = first.map((ref) => ({ from: htmlFile, ref }));
  for (let depth = 0; depth < SCAN_MAX_CSS_DEPTH && queue.length > 0; depth++) {
    const next: typeof queue = [];
    for (const { from, ref } of queue) {
      for (const packed of (await scanStylesheet(run, from, ref)) ?? []) {
        const [file, imported] = packed.split("\u0000");
        next.push({ from: file, ref: imported });
      }
    }
    queue = next;
  }
  if (queue.length > 0) run.out.incomplete = true; // depth bound reached with unfollowed imports
}

/**
 * Scan the HTML document at `htmlFile` (a real path inside `root`) and the
 * same-root stylesheets it pulls in. Never throws: a failure is `incomplete`.
 */
export async function scanHtmlFile(root: string, htmlFile: string): Promise<ScanOutcome> {
  const out: ScanOutcome = { origins: [], incomplete: false, rootAbsolute: false, dependencies: [] };
  let realRoot: string;
  try {
    realRoot = await fs.promises.realpath(root);
  } catch {
    return { ...out, incomplete: true };
  }
  const dep = await statDep(htmlFile);
  if (dep) out.dependencies.push(dep);
  const doc = await readCapped(htmlFile, SCAN_MAX_HTML_BYTES);
  if (!doc) return { ...out, incomplete: true };
  if (doc.truncated) out.incomplete = true;

  const first = scanMarkup(doc.text);
  out.rootAbsolute = first.rootAbsolute;
  const run: ScanRun = { realRoot, origins: new Set(first.origins), out, seen: new Set() };
  await followStylesheets(run, htmlFile, first.stylesheets);

  out.origins = [...run.origins].slice(0, SCAN_MAX_ORIGINS);
  if (run.origins.size > SCAN_MAX_ORIGINS) out.incomplete = true;
  return out;
}

/** Is a previously computed outcome still valid (every dependency unchanged)? */
export async function scanStillValid(outcome: ScanOutcome): Promise<boolean> {
  for (const d of outcome.dependencies) {
    const now = await statDep(d.file);
    if (!now || now.mtimeMs !== d.mtimeMs || now.size !== d.size) return false;
  }
  return true;
}

/**
 * `pi-craft doc prepare <in.md> --out <dir>` — prepare Markdown + a DOCX template so WordCraft can publish a
 * templated document headless: resolve template and variables, fill every `{{ var }}` / `<var>` placeholder the
 * WordCraft CLI cannot reach (cover textboxes, first-page header/footer, split runs), inline images as data URIs
 * and render Mermaid blocks to PNG.
 *
 * Security posture (untrusted Markdown/frontmatter): the docx is unzipped in memory (entry names are never
 * filesystem paths); matching runs on decoded `w:t` text only and values are re-escaped; template name is a strict
 * token; `templates_dir` and image paths are realpath-confined; `mmdc` / `pi-nano-banana` are spawned with argv, no
 * shell; image/diagram syntax arriving through a variable value is never inlined (images and diagrams are processed
 * before substitution).
 *
 * Exit codes: 0 ok · 1 failed operation / unresolved placeholders without `--allow-missing` · 2 usage.
 *
 * See change: add-craft-office-workflows (design D3).
 */
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { unzipSync, type Zippable, zipSync } from "fflate";
import { parse as parseYaml } from "yaml";
import { resolveNanoBananaLauncher } from "./region-replace.js";

export const DOC_USAGE = `usage: pi-craft doc prepare <in.md> --out <dir> [--template <name>] [--templates-dir <dir>] [--var k=v]…
                           [--allow-path <dir>]… [--allow-missing] [--json]

Fills the docx template's placeholders (frontmatter, --var, template defaults, system variables), inlines images
and renders Mermaid blocks. Writes <dir>/template.filled.docx, <dir>/body.md and <dir>/prepare.json.

exit: 0 ok · 1 failed / unresolved placeholders without --allow-missing · 2 usage`;

// ── Types ───────────────────────────────────────────────────────────────────

type VarSource = "default" | "system" | "frontmatter" | "cli";

export interface PrepareReport {
  template: string;
  templatePath: string;
  vars: Record<string, VarSource>;
  defaulted: string[];
  unresolved: string[];
  ignored: string[];
  warnings: string[];
  toc: { enabled: boolean; heading: string; levels: number };
  title: string;
  mermaid: { style: string | null; rendered: number; cached: number; fallback: number; unrendered: number };
  images: { inlined: number; skipped: { path: string; reason: string }[]; remote: string[] };
  /**
   * Set only when the template owns images (see `templateHasImages`): body images are not data URIs but `marker`
   * tokens in body.md, with the image written to `<out>/<file>`; the render step puts each one in with
   * `edit.find` + `insert.picture` + `edit.replaceAll`.
   */
  pictures?: { marker: string; file: string; alt: string }[];
}

export interface PrepareDeps {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  homedir: string;
  now: () => Date;
  /** Bare command on PATH → absolute path. */
  which: (name: string) => string | undefined;
  /** argv-only spawn (never a shell). Rejects on non-zero exit. */
  run: (file: string, args: string[], opts?: { timeout?: number }) => Promise<void>;
  /** The `pi-nano-banana` entry: a PATH command, else the workspace launcher run through node. */
  nanoBanana: () => { file: string; prefix: string[] } | undefined;
}

interface ParsedPrepare {
  input: string;
  out: string;
  template?: string;
  templatesDir?: string;
  vars: Map<string, string>;
  allowPaths: string[];
  allowMissing: boolean;
  json: boolean;
}

class PrepareError extends Error {
  readonly code: 1 | 2;
  constructor(message: string, code: 1 | 2) {
    super(message);
    this.code = code;
  }
}

// ── Defaults ────────────────────────────────────────────────────────────────

/** Resolve `name` on `pathVar`, honouring PATHEXT on Windows. */
function findOnPath(name: string, pathVar: string | undefined, platform: NodeJS.Platform = process.platform, pathExt = ".EXE;.CMD;.BAT"): string | undefined {
  const exts = platform === "win32" ? ["", ...pathExt.split(";").filter(Boolean)] : [""];
  for (const dir of (pathVar ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean)) {
    for (const ext of exts) {
      const f = path.join(dir, name + ext);
      try {
        if (fs.statSync(f).isFile()) return f;
      } catch {
        /* next */
      }
    }
  }
  return undefined;
}

function defaultPrepareDeps(env: NodeJS.ProcessEnv = process.env): PrepareDeps {
  const which = (name: string) => findOnPath(name, env.PATH ?? env.Path, process.platform, env.PATHEXT);
  return {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    env,
    cwd: process.cwd(),
    homedir: os.homedir(),
    now: () => new Date(),
    which,
    run: async (file, args, opts) => {
      try {
        await execFileAsync(file, args, { timeout: opts?.timeout ?? 120_000, maxBuffer: 16 * 1024 * 1024, env });
      } catch (e) {
        const err = e as { stderr?: string | Buffer; message: string };
        const first = (err.stderr?.toString() ?? "").split("\n").find((l) => l.trim());
        throw new Error(first?.trim() || err.message.split("\n")[0]);
      }
    },
    nanoBanana: () => {
      const onPath = which("pi-nano-banana");
      if (onPath) return { file: onPath, prefix: [] };
      try {
        return { file: process.execPath, prefix: [resolveNanoBananaLauncher(import.meta.url)] };
      } catch {
        return undefined;
      }
    },
  };
}

// ── Arguments ───────────────────────────────────────────────────────────────

/** Options that take a value. */
const VALUE_OPTIONS: Record<string, (p: ParsedPrepare, v: string) => void> = {
  "--out": (p, v) => {
    p.out = v;
  },
  "--template": (p, v) => {
    p.template = v;
  },
  "--templates-dir": (p, v) => {
    p.templatesDir = v;
  },
  "--allow-path": (p, v) => {
    p.allowPaths.push(v);
  },
  "--var": (p, kv) => {
    const eq = kv.indexOf("=");
    if (eq <= 0) throw new PrepareError(`--var expects name=value, got "${kv}"`, 2);
    const name = kv.slice(0, eq);
    if (!VAR_NAME.test(name)) throw new PrepareError(`--var: invalid variable name "${name}"`, 2);
    p.vars.set(name, kv.slice(eq + 1));
  },
};
const FLAG_OPTIONS: Record<string, (p: ParsedPrepare) => void> = {
  "--allow-missing": (p) => {
    p.allowMissing = true;
  },
  "--json": (p) => {
    p.json = true;
  },
};

function setInput(p: ParsedPrepare, a: string): void {
  if (a.startsWith("-")) throw new PrepareError(`unknown option ${a}`, 2);
  if (p.input) throw new PrepareError(`unexpected argument ${a}`, 2);
  p.input = a;
}

function parsePrepareArgs(argv: string[]): ParsedPrepare | { help: true } {
  const p: ParsedPrepare = { input: "", out: "", vars: new Map(), allowPaths: [], allowMissing: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { help: true };
    if (a in VALUE_OPTIONS) {
      const v = argv[++i];
      if (v === undefined) throw new PrepareError(`${a} needs a value`, 2);
      VALUE_OPTIONS[a](p, v);
    } else if (a in FLAG_OPTIONS) FLAG_OPTIONS[a](p);
    else setInput(p, a);
  }
  if (!p.input) throw new PrepareError("missing <in.md>", 2);
  if (!p.out) throw new PrepareError("missing --out <dir>", 2);
  return p;
}

// ── Frontmatter ─────────────────────────────────────────────────────────────

const VAR_NAME = /^[A-Za-z_$][A-Za-z0-9_.:-]*$/;
const TEMPLATE_NAME = /^[A-Za-z0-9_-]+$/;
/** Keys this helper interprets itself (doc-engine names + `nano_banana`). */
const HANDLED_KEYS = new Set(["template", "templates_dir", "language", "document_title", "document_name", "enable_toc", "toc_heading", "nano_banana", "variables"]);
/** doc-engine-only option keys (frontmatter_parser.KNOWN_OPTION_KEYS minus the handled ones): reported as ignored. */
const ENGINE_ONLY_KEYS = new Set([
  "enable_cover_page", "toc_style", "diagram_format", "diagram_width", "diagram_scale", "embed_svg_in_word", "diagrams", "code_style", "tree_style",
  "font_name", "embed_fonts", "table_style", "table_profiles", "image_style", "logos", "debug",
]);

function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { data: {}, body: text };
  let data: unknown;
  try {
    data = parseYaml(m[1]);
  } catch (e) {
    throw new PrepareError(`frontmatter is not valid YAML: ${(e as Error).message.split("\n")[0]}`, 1);
  }
  if (data !== null && data !== undefined && (typeof data !== "object" || Array.isArray(data))) throw new PrepareError("frontmatter must be a YAML mapping", 1);
  return { data: (data ?? {}) as Record<string, unknown>, body: text.slice(m[0].length) };
}

const isScalar = (v: unknown): v is string | number | boolean => ["string", "number", "boolean"].includes(typeof v);

// ── Template + path resolution ──────────────────────────────────────────────

function realOrResolve(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

const within = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

interface Confine {
  roots: string[];
  allows: (p: string) => boolean;
}

function confinement(mdDir: string, allow: string[], cwd: string): Confine {
  const roots = [realOrResolve(mdDir), ...allow.map((a) => realOrResolve(path.resolve(cwd, a)))];
  return { roots, allows: (p) => roots.some((r) => within(realOrResolve(p), r)) };
}

function resolveTemplatesDir(p: ParsedPrepare, fm: Record<string, unknown>, mdDir: string, conf: Confine, deps: PrepareDeps): string {
  if (p.templatesDir) return path.resolve(deps.cwd, p.templatesDir);
  if (typeof fm.templates_dir === "string" && fm.templates_dir) {
    const dir = path.resolve(mdDir, fm.templates_dir);
    if (!conf.allows(dir)) throw new PrepareError(`frontmatter templates_dir "${fm.templates_dir}" resolves outside the input's directory (${dir}); pass --allow-path or --templates-dir`, 1);
    return dir;
  }
  if (deps.env.PI_DOC_TEMPLATES_DIR) return path.resolve(deps.cwd, deps.env.PI_DOC_TEMPLATES_DIR);
  for (const d of [path.join(deps.cwd, "templates"), path.join(deps.homedir, "Documents", "templates")]) if (isDir(d)) return d;
  throw new PrepareError("no templates directory found (--templates-dir, frontmatter templates_dir, $PI_DOC_TEMPLATES_DIR, ./templates, ~/Documents/templates)", 1);
}

const isDir = (d: string): boolean => {
  try {
    return fs.statSync(d).isDirectory();
  } catch {
    return false;
  }
};

const unescapeXml = (s: string): string =>
  s.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(lt|gt|amp|quot|apos));/g, (_m, hex, dec, name) => {
    if (name) return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[name as string] as string;
    const cp = hex ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
    return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
  });

/** Escape for XML text; also drops characters XML 1.0 forbids. */
const escapeXml = (s: string): string => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface TemplateMeta {
  defaults: Map<string, string>;
  /** name → syntaxes seen in manifest.xml (`both` | `mustache`…). */
  syntax: Map<string, Set<string>>;
}

/** Drop XML comments until none is left (one pass can leave a new `<!--` behind when comments nest oddly). */
function stripComments(xml: string): string {
  let out = xml;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/<!--[\s\S]*?-->/g, "");
  }
  return out;
}

function readTemplateMeta(dir: string): TemplateMeta {
  const read = (f: string): string => {
    try {
      return stripComments(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch {
      return "";
    }
  };
  const defaults = new Map<string, string>();
  for (const m of read("variables.xml").matchAll(/<variable\b[^>]*?\bname="([^"]+)"[^>]*>([\s\S]*?)<\/variable>/g)) {
    const d = /<default>([\s\S]*?)<\/default>/.exec(m[2]);
    // `logo:*` entries are image slots (doc-engine logo_manager), not text variables.
    if (d && !m[1].startsWith("logo:")) defaults.set(unescapeXml(m[1]), unescapeXml(d[1]));
  }
  const syntax = new Map<string, Set<string>>();
  for (const m of read("manifest.xml").matchAll(/<variable\b([^>]*?)\/?>/g)) {
    const name = /\bname="([^"]+)"/.exec(m[1])?.[1];
    const syn = /\bsyntax="([^"]+)"/.exec(m[1])?.[1];
    if (name && syn) syntax.set(unescapeXml(name), (syntax.get(unescapeXml(name)) ?? new Set()).add(syn));
  }
  return { defaults, syntax };
}

/** Names whose `<name>` form may be replaced: manifest `both`, or declared in variables.xml with no manifest syntax. */
function angleNames(meta: TemplateMeta): Set<string> {
  const out = new Set<string>();
  for (const [name, syns] of meta.syntax) if (syns.has("both")) out.add(name);
  for (const name of meta.defaults.keys()) if (!meta.syntax.has(name)) out.add(name);
  return out;
}

// ── System variables (doc-engine parity: system_variables.py) ───────────────

const MONTHS: Record<string, string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  hu: ["januar", "februar", "marcius", "aprilis", "majus", "junius", "julius", "augusztus", "szeptember", "oktober", "november", "december"],
  de: ["Januar", "Februar", "Marz", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
  fr: ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"],
};

function formatDate(d: Date, language: string): string {
  const lang = language in MONTHS ? language : "en";
  const month = MONTHS[lang][d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  if (lang === "hu") return `${year}. ${month} ${day}.`;
  if (lang === "de") return `${day}. ${month} ${year}`;
  if (lang === "fr") return `${day} ${month} ${year}`;
  return `${month} ${day}, ${year}`;
}

// ── docx fill ───────────────────────────────────────────────────────────────

const MUSTACHE = /\{\{\s*([A-Za-z_$][A-Za-z0-9_.:-]*)\s*\}\}/g;
const PART = /^word\/(?:document|header[^/]*|footer[^/]*)\.xml$/;
/** Zip-bomb guard: total decompressed size of one docx. */
const MAX_DOCX_BYTES = 512 * 1024 * 1024;

interface FillCtx {
  values: Map<string, string>;
  angle: Set<string>;
  unresolved: Set<string>;
  ignored: Set<string>;
}

/** Replace placeholders in a decoded string. Returns the pieces so callers can map them back to nodes. */
function findPlaceholders(s: string, angle: Set<string>): { start: number; end: number; name: string }[] {
  const found: { start: number; end: number; name: string }[] = [];
  for (const m of s.matchAll(MUSTACHE)) found.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, name: m[1] });
  if (angle.size) {
    for (const m of s.matchAll(/<([A-Za-z_$][A-Za-z0-9_.:-]*)>/g)) if (angle.has(m[1])) found.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, name: m[1] });
  }
  return found.sort((a, b) => a.start - b.start);
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * Placeholders of one paragraph's text: the edits to apply, plus bookkeeping on `ctx` (ignored `logo:`/`$toc` slots,
 * unresolved names, and a `{{` / `}}` left dangling — a token split across paragraphs).
 */
function scanParagraph(whole: string, ctx: FillCtx): Edit[] {
  const edits: Edit[] = [];
  let rest = "";
  let from = 0;
  for (const ph of findPlaceholders(whole, ctx.angle)) {
    rest += `${whole.slice(from, ph.start)}\u0000`;
    from = ph.end;
    const v = ctx.values.get(ph.name);
    if (ph.name.startsWith("logo:") || ph.name === "$toc") ctx.ignored.add(ph.name);
    else if (v === undefined) ctx.unresolved.add(ph.name);
    else edits.push({ start: ph.start, end: ph.end, text: v });
  }
  rest += whole.slice(from);
  for (const fragment of [/\{\{[^}\u0000]*$/.exec(rest)?.[0], /^[^{\u0000]*\}\}/.exec(rest)?.[0]]) if (fragment) ctx.unresolved.add(fragment.trim());
  return edits;
}

/**
 * Apply edits (original coordinates, applied right-to-left) to the per-node texts: the replacement lands in the first
 * covered node, the rest of the covered span is removed from the following nodes. Returns null for untouched nodes.
 */
function applyEdits(nodes: string[], edits: Edit[]): (string | null)[] {
  const starts = nodes.map((_, i) => nodes.slice(0, i).reduce((n, t) => n + t.length, 0));
  const texts = [...nodes];
  const touched = new Set<number>();
  for (const ed of [...edits].sort((a, b) => b.start - a.start)) {
    let first = true;
    for (let i = 0; i < texts.length; i++) {
      const lo = Math.max(ed.start, starts[i]);
      const hi = Math.min(ed.end, starts[i] + nodes[i].length);
      if (hi <= lo) continue;
      texts[i] = texts[i].slice(0, lo - starts[i]) + (first ? ed.text : "") + texts[i].slice(hi - starts[i]);
      touched.add(i);
      first = false;
    }
  }
  return texts.map((t, i) => (touched.has(i) ? t : null));
}

/** Fill one paragraph's `w:t` nodes. `nodes` are decoded texts; returns the new decoded texts (null = unchanged). */
function fillParagraph(nodes: string[], ctx: FillCtx): (string | null)[] {
  const whole = nodes.join("");
  if (!whole.includes("{{") && !whole.includes("}}") && !whole.includes("<")) return nodes.map(() => null);
  return applyEdits(nodes, scanParagraph(whole, ctx));
}

interface TNode {
  /** token index of the `<w:t …>` open tag, and of its text */
  open: number;
  text: number;
}

/** Fill one paragraph's nodes in `tokens` in place; true when any node changed. */
function writeParagraph(tokens: string[], nodes: TNode[], ctx: FillCtx): boolean {
  const res = fillParagraph(nodes.map((n) => unescapeXml(tokens[n.text])), ctx);
  res.forEach((r, k) => {
    if (r === null) return;
    const n = nodes[k];
    tokens[n.text] = escapeXml(r);
    if (!/xml:space=/.test(tokens[n.open])) tokens[n.open] = tokens[n.open].replace(/^<w:t\b/, '<w:t xml:space="preserve"');
  });
  return res.some((r) => r !== null);
}

const isParaOpen = (t: string): boolean => /^<w:p[\s>]/.test(t) && !t.endsWith("/>");
/** `<w:t …>` followed by its text token. */
const isTextNode = (tokens: string[], i: number): boolean => /^<w:t[\s>]/.test(tokens[i]) && !tokens[i].endsWith("/>") && tokens[i + 1]?.startsWith("<") === false;

/** Track paragraphs and their `w:t` nodes while scanning token `i`; true when a closed paragraph was edited. */
function scanToken(tokens: string[], i: number, stack: TNode[][], ctx: FillCtx): boolean {
  const t = tokens[i];
  if (!t.startsWith("<")) return false;
  if (isParaOpen(t)) stack.push([]);
  else if (t === "</w:p>") {
    const nodes = stack.pop();
    return !!nodes?.length && writeParagraph(tokens, nodes, ctx);
  } else if (stack.length && isTextNode(tokens, i)) stack[stack.length - 1].push({ open: i, text: i + 1 });
  return false;
}

/** Fill one xml part. Returns the new xml, or null when nothing changed. */
function fillXml(xml: string, ctx: FillCtx): string | null {
  const tokens = xml.match(/<[^>]*>|[^<]+/g) ?? [];
  const stack: TNode[][] = [];
  let changed = false;
  for (let i = 0; i < tokens.length; i++) if (scanToken(tokens, i, stack, ctx)) changed = true;
  return changed ? tokens.join("") : null;
}

function fillDocx(docx: Uint8Array, ctx: FillCtx): Uint8Array {
  let total = 0;
  const files = unzipSync(docx, {
    filter: (f) => {
      total += f.originalSize;
      if (total > MAX_DOCX_BYTES) throw new PrepareError("template.docx is too large when decompressed", 1);
      return true;
    },
  });
  const dec = new TextDecoder("utf-8");
  const enc = new TextEncoder();
  const out: Zippable = {};
  for (const [name, data] of Object.entries(files)) {
    let bytes = data;
    if (PART.test(name)) {
      const filled = fillXml(dec.decode(data), ctx);
      if (filled !== null) bytes = enc.encode(filled);
    }
    out[name] = [bytes, { level: /^word\/media\//.test(name) ? 0 : 6, mtime: new Date(1980, 0, 1) }];
  }
  return zipSync(out);
}

/** True when the template's document part owns an image relationship (a cover logo, a picture…). */
function templateHasImages(docx: Uint8Array): boolean {
  const rels = unzipSync(docx, { filter: (f) => f.name === "word/_rels/document.xml.rels" })["word/_rels/document.xml.rels"];
  return !!rels && /relationships\/image"/.test(new TextDecoder().decode(rels));
}

// ── Body ────────────────────────────────────────────────────────────────────

interface Segment {
  fence: boolean;
  text: string;
  info: string;
  code: string;
}

/** Split Markdown into prose and fenced-code segments (text of all segments re-joins to the input). */
function segments(md: string): Segment[] {
  const lines = md.split("\n");
  const out: Segment[] = [];
  let prose: string[] = [];
  const flush = () => {
    if (prose.length) out.push({ fence: false, text: prose.join("\n"), info: "", code: "" });
    prose = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,}|~{3,})\s*(.*?)\s*$/.exec(lines[i]);
    if (!open) {
      prose.push(lines[i]);
      continue;
    }
    let j = i + 1;
    const close = new RegExp(`^\\s*${open[2][0]}{${open[2].length},}\\s*$`);
    while (j < lines.length && !close.test(lines[j])) j++;
    flush();
    out.push({ fence: true, text: lines.slice(i, Math.min(j, lines.length - 1) + 1).join("\n"), info: open[3].split(/\s+/)[0].toLowerCase(), code: lines.slice(i + 1, j).join("\n") });
    i = j;
  }
  flush();
  return out;
}

/** One inlined image above this is skipped (the data URI would be 4/3 of it, in memory, twice). */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp" };

const md5 = (s: string): string => createHash("md5").update(s).digest("hex");

interface NanoStyle {
  name: string | null;
  prompt: string;
}

function resolveStyle(nb: { enabled: boolean; style?: string }, templateDir: string): NanoStyle {
  let doc: { default?: string; styles?: Record<string, { prompt?: string; negative?: string }> } = {};
  try {
    doc = (parseYaml(fs.readFileSync(path.join(templateDir, "nano-banana-styles.yaml"), "utf8")) as typeof doc) ?? {};
  } catch {
    /* no styles file */
  }
  const requested = nb.style?.trim();
  const name = requested || doc.default || "";
  const spec = doc.styles?.[name];
  if (spec?.prompt) return { name, prompt: `${spec.prompt}${spec.negative ? `\n\nAVOID: ${spec.negative}` : ""}` };
  // Not a named style: an inline prompt when given, else no style block.
  return { name: name || null, prompt: requested && !spec ? requested : "" };
}

// ── Orchestration ───────────────────────────────────────────────────────────

export async function prepareDoc(argv: string[], partial: Partial<PrepareDeps> = {}): Promise<number> {
  const deps: PrepareDeps = { ...defaultPrepareDeps(partial.env ?? process.env), ...partial };
  let parsed: ParsedPrepare | { help: true };
  try {
    parsed = parsePrepareArgs(argv);
  } catch (e) {
    deps.stderr(`pi-craft doc prepare: ${(e as Error).message}\n${DOC_USAGE}\n`);
    return 2;
  }
  if ("help" in parsed) {
    deps.stderr(`${DOC_USAGE}\n`);
    return 0;
  }
  try {
    const report = await runPrepare(parsed, deps);
    if (parsed.json) deps.stdout(`${JSON.stringify(report)}\n`);
    else deps.stdout(summary(report, parsed.out));
    return report.unresolved.length && !parsed.allowMissing ? 1 : 0;
  } catch (e) {
    if (e instanceof PrepareError) {
      deps.stderr(`pi-craft doc prepare: ${e.message}\n`);
      return e.code;
    }
    deps.stderr(`pi-craft doc prepare: ${(e as Error).message}\n`);
    return 1;
  }
}

function summary(r: PrepareReport, out: string): string {
  const lines = [`template: ${r.templatePath}`, `out: ${out}`];
  if (r.defaulted.length) lines.push(`defaulted: ${r.defaulted.join(", ")}`);
  if (r.unresolved.length) lines.push(`unresolved: ${r.unresolved.join(", ")}`);
  lines.push(`mermaid: ${r.mermaid.rendered} rendered, ${r.mermaid.unrendered} unrendered · images: ${r.images.inlined} inlined, ${r.images.skipped.length} skipped, ${r.images.remote.length} remote`);
  for (const w of r.warnings) lines.push(`warning: ${w}`);
  return `${lines.join("\n")}\n`;
}

interface Variables {
  values: Map<string, string>;
  sources: Map<string, VarSource>;
  ignored: Set<string>;
}

/** Variables by precedence (default < system < frontmatter < `--var`) and the frontmatter keys that are ignored. */
function collectVariables(p: ParsedPrepare, fm: Record<string, unknown>, meta: TemplateMeta, inputPath: string, deps: PrepareDeps): Variables {
  const v: Variables = { values: new Map(), sources: new Map(), ignored: new Set() };
  const set = (name: string, value: string, source: VarSource) => {
    v.values.set(name, value);
    v.sources.set(name, source);
  };
  for (const [k, d] of meta.defaults) set(k, d, "default");
  const now = deps.now();
  const pad = (n: number) => String(n).padStart(2, "0");
  set("$date", formatDate(now, typeof fm.language === "string" ? fm.language : "en"), "system");
  set("$fileName", path.basename(inputPath), "system");
  set("$year", String(now.getFullYear()), "system");
  set("$month", pad(now.getMonth() + 1), "system");
  set("$day", pad(now.getDate()), "system");
  const fmVar = (k: string, val: unknown) => {
    if (isScalar(val) && VAR_NAME.test(k)) set(k, String(val), "frontmatter");
    else v.ignored.add(k);
  };
  for (const [k, val] of Object.entries(fm)) {
    if (k === "variables" && val && typeof val === "object" && !Array.isArray(val)) {
      for (const [vk, vv] of Object.entries(val as Record<string, unknown>)) fmVar(vk, vv);
    } else if (ENGINE_ONLY_KEYS.has(k)) v.ignored.add(k);
    else if (!HANDLED_KEYS.has(k)) fmVar(k, val);
  }
  for (const [k, val] of p.vars) set(k, val, "cli");
  return v;
}

function resolveTemplate(p: ParsedPrepare, fm: Record<string, unknown>, mdDir: string, conf: Confine, deps: PrepareDeps): { name: string; dir: string; path: string } {
  const name = p.template ?? (typeof fm.template === "string" ? fm.template : "default");
  if (!TEMPLATE_NAME.test(name)) throw new PrepareError(`invalid template name "${name}" (letters, digits, _ and - only)`, 2);
  const dir = path.join(resolveTemplatesDir(p, fm, mdDir, conf, deps), name);
  const file = path.join(dir, "template.docx");
  if (!fs.existsSync(file)) throw new PrepareError(`template not found: ${file}`, 1);
  return { name, dir, path: file };
}

/**
 * Body images → Markdown. Probe 0.2 drift (WordCraft 0.7.0): a Markdown-imported image lands on the template's first image
 * whenever the template owns one; then `report.pictures` is set and images go out as `CRAFTIMG<n>` markers + files.
 */
function makePlace(report: PrepareReport, outDir: string): BodyCtx["place"] {
  return (bytes, mime, alt) => {
    if (!report.pictures) return `![${alt}](data:${mime};base64,${Buffer.from(bytes).toString("base64")})`;
    const n = String(report.pictures.length + 1).padStart(4, "0");
    const file = path.posix.join("images", `${n}${mime === "image/jpeg" ? ".jpg" : `.${mime.split("/")[1]}`}`);
    fs.mkdirSync(path.join(outDir, "images"), { recursive: true });
    writeAtomic(path.join(outDir, file), bytes);
    report.pictures.push({ marker: `CRAFTIMG${n}`, file, alt });
    return `CRAFTIMG${n}`;
  };
}

function documentTitle(fm: Record<string, unknown>, body: string, inputPath: string): string {
  for (const k of ["document_title", "document_name"]) if (typeof fm[k] === "string") return fm[k] as string;
  return /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? path.basename(inputPath, path.extname(inputPath));
}

async function runPrepare(p: ParsedPrepare, deps: PrepareDeps): Promise<PrepareReport> {
  const inputPath = path.resolve(deps.cwd, p.input);
  let text: string;
  try {
    text = fs.readFileSync(inputPath, "utf8");
  } catch {
    throw new PrepareError(`cannot read ${p.input}`, 1);
  }
  const mdDir = path.dirname(inputPath);
  const { data: fm, body: rawBody } = splitFrontmatter(text);
  const conf = confinement(mdDir, p.allowPaths, deps.cwd);
  const template = resolveTemplate(p, fm, mdDir, conf, deps);
  const meta = readTemplateMeta(template.dir);
  const vars = collectVariables(p, fm, meta, inputPath, deps);

  const nbRaw = fm.nano_banana && typeof fm.nano_banana === "object" ? (fm.nano_banana as Record<string, unknown>) : {};
  const nb = { enabled: nbRaw.enabled === true, style: typeof nbRaw.style === "string" ? nbRaw.style : undefined };
  const style = nb.enabled ? resolveStyle(nb, template.dir) : { name: null, prompt: "" };

  const ctx: FillCtx = { values: vars.values, angle: angleNames(meta), unresolved: new Set(), ignored: vars.ignored };
  const templateBytes = fs.readFileSync(template.path);
  const filled = fillDocx(templateBytes, ctx);

  const report: PrepareReport = {
    template: template.name,
    templatePath: template.path,
    vars: {},
    defaulted: [],
    unresolved: [],
    ignored: [],
    warnings: [],
    toc: { enabled: fm.enable_toc === true || fm.enable_toc === "true", heading: typeof fm.toc_heading === "string" ? fm.toc_heading : "Table of Contents", levels: 3 },
    title: "",
    mermaid: { style: style.name, rendered: 0, cached: 0, fallback: 0, unrendered: 0 },
    images: { inlined: 0, skipped: [], remote: [] },
  };
  if (templateHasImages(templateBytes)) report.pictures = [];
  const outDir = path.resolve(deps.cwd, p.out);
  // Images and diagrams first (original text), then variables in prose.
  const body = await prepareBody(rawBody, { place: makePlace(report, outDir), mdDir, conf, report, ctx, nb, style, deps });

  report.title = documentTitle(fm, body, inputPath);
  for (const [k, src] of [...vars.sources].sort(([a], [b]) => a.localeCompare(b))) report.vars[k] = src;
  report.defaulted = [...vars.sources].filter(([, src]) => src === "default").map(([k]) => k).sort();
  report.unresolved = [...ctx.unresolved].sort();
  report.ignored = [...vars.ignored].sort();

  fs.mkdirSync(outDir, { recursive: true });
  writeAtomic(path.join(outDir, "template.filled.docx"), filled);
  writeAtomic(path.join(outDir, "body.md"), body);
  writeAtomic(path.join(outDir, "prepare.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/** Write through an exclusively-created temp file + rename, so a symlink at `file` (or at the temp name) is never followed. */
function writeAtomic(file: string, data: string | Uint8Array): void {
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, data, { flag: "wx" });
  fs.renameSync(tmp, file);
}

interface BodyCtx {
  /** Turn image bytes into body Markdown: a `data:` image, or a picture marker (see `pictureMarkers`). */
  place: (bytes: Uint8Array, mime: string, alt: string) => string;
  mdDir: string;
  conf: Confine;
  report: PrepareReport;
  ctx: FillCtx;
  nb: { enabled: boolean; style?: string };
  style: NanoStyle;
  deps: PrepareDeps;
}

async function prepareBody(raw: string, c: BodyCtx): Promise<string> {
  const out: string[] = [];
  for (const seg of segments(raw)) {
    if (!seg.fence) {
      out.push(substitute(inlineImages(seg.text, c), c));
    } else if (seg.info === "mermaid") {
      out.push(await renderMermaid(seg, c));
    } else {
      if (seg.info === "plantuml" || seg.info === "puml") c.report.warnings.push("PlantUML block left as code (use document-converter for PlantUML)");
      out.push(seg.text);
    }
  }
  return out.join("\n");
}

/** `{{ name }}` in prose; values are inserted literally (never re-scanned for image/diagram syntax). */
function substitute(prose: string, c: BodyCtx): string {
  return prose.replace(MUSTACHE, (whole, name: string) => {
    if (name.startsWith("logo:") || name === "$toc") {
      c.ctx.ignored.add(name);
      return whole;
    }
    const v = c.ctx.values.get(name);
    if (v === undefined) {
      c.ctx.unresolved.add(name);
      return whole;
    }
    if (/!\[[^\]]*\]\(|^\s*(`{3,}|~{3,})/m.test(v)) c.report.warnings.push(`variable "${name}" contains image/diagram syntax; left literal, not inlined or rendered`);
    return v;
  });
}

/** A local image ref → the file to inline, or why it is refused. The path is canonicalised (realpath) before the check. */
function resolveImage(ref: string, c: BodyCtx): { real: string; mime: string } | { skip: string } {
  let file: string;
  try {
    file = /^file:/i.test(ref) ? fileURLToPath(ref) : path.resolve(c.mdDir, safeDecode(ref));
  } catch {
    return { skip: "invalid path" };
  }
  if (!fs.existsSync(file)) return { skip: "file not found" };
  const real = fs.realpathSync(file);
  if (!c.conf.allows(real)) return { skip: "outside the input's directory and --allow-path" };
  const mime = IMAGE_TYPES[path.extname(real).toLowerCase()];
  if (!mime) return { skip: "unsupported image type" };
  if (fs.statSync(real).size > MAX_IMAGE_BYTES) return { skip: "image too large" };
  return { real, mime };
}

function inlineImages(prose: string, c: BodyCtx): string {
  return prose.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?((?:\s+"[^"]*")?)\s*\)/g, (whole, alt: string, ref: string) => {
    if (/^data:/i.test(ref)) return whole;
    if (/^https?:\/\//i.test(ref)) {
      c.report.images.remote.push(ref);
      return whole;
    }
    const img = resolveImage(ref, c);
    if ("skip" in img) {
      c.report.images.skipped.push({ path: ref, reason: img.skip });
      return whole;
    }
    c.report.images.inlined++;
    return c.place(fs.readFileSync(img.real), img.mime, alt);
  });
}

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** nano-banana route: the md5 cache, else one `pi-nano-banana` call. null = fall back to mmdc. */
async function renderViaNano(source: string, c: BodyCtx): Promise<{ png: Buffer; cached: boolean } | null> {
  const cacheDir = path.join(c.mdDir, ".mermaid-cache");
  // The key covers the style's name AND its prompt text, so editing a style under the same name never reuses a stale png.
  const cached = path.join(cacheDir, `${md5(`${c.style.name ?? ""}\n${c.style.prompt}\n${source}`)}.png`);
  if (fs.existsSync(cached)) return { png: fs.readFileSync(cached), cached: true };
  const nano = c.deps.nanoBanana();
  if (!nano) return null;
  fs.mkdirSync(cacheDir, { recursive: true });
  // A leading label keeps diagram text that starts with `-` from being read as an option by the CLI.
  const prompt = `Diagram:\n${source}${c.style.prompt ? `\n\n${c.style.prompt}` : ""}`;
  try {
    await c.deps.run(nano.file, [...nano.prefix, prompt, "--output", cached], { timeout: 180_000 });
  } catch {
    return null;
  }
  return fs.existsSync(cached) ? { png: fs.readFileSync(cached), cached: false } : null;
}

/** Host `mmdc`, argv only. Returns the png, or the reason it could not render. */
async function renderViaMmdc(source: string, deps: PrepareDeps): Promise<{ png: Buffer } | { error: string }> {
  const mmdc = deps.which("mmdc");
  if (!mmdc) return { error: "mmdc not found on PATH: Mermaid blocks left as code (install @mermaid-js/mermaid-cli or accept code blocks)" };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-craft-mmd-"));
  try {
    const input = path.join(tmp, "diagram.mmd");
    const output = path.join(tmp, "diagram.png");
    fs.writeFileSync(input, source);
    await deps.run(mmdc, ["-i", input, "-o", output, "-b", "white", "-w", "1400", "-s", "2"], { timeout: 120_000 });
    return fs.existsSync(output) ? { png: fs.readFileSync(output) } : { error: "mmdc exited 0 but wrote no image: block left as code" };
  } catch (e) {
    return { error: `mmdc failed (${(e as Error).message.split("\n")[0].slice(0, 120)}): block left as code` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function renderMermaid(seg: Segment, c: BodyCtx): Promise<string> {
  const { mermaid, warnings } = c.report;
  const nano = c.nb.enabled ? await renderViaNano(seg.code, c) : null;
  if (nano) {
    mermaid.rendered++;
    if (nano.cached) mermaid.cached++;
    return c.place(nano.png, "image/png", "diagram");
  }
  const res = await renderViaMmdc(seg.code, c.deps);
  if ("error" in res) {
    mermaid.unrendered++;
    if (!warnings.includes(res.error)) warnings.push(res.error);
    return seg.text;
  }
  mermaid.rendered++;
  if (c.nb.enabled) mermaid.fallback++;
  return c.place(res.png, "image/png", "diagram");
}

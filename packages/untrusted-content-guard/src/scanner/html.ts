/**
 * Hidden-HTML layer (design D1, "HTML removal").
 *
 * Works on SOURCE RANGES from htmlparser2's `startIndex`/`endIndex`; the
 * document is never re-serialised. Two kinds of edit:
 *   1. a hidden element (or comment) with visible text → its whole source range
 *      is removed;
 *   2. a visible text node whose DECODED text the Unicode/ANSI layers change →
 *      only that node's source range is rewritten with the cleaned text,
 *      re-escaping `&`, `<`, `>`.
 * Every other byte stays identical.
 *
 * Styles come from inline `style` and from embedded `<style>` rules whose
 * selector is a single type, `.class` or `#id` (or a comma list of those).
 * A more complex selector in a rule that sets a hiding property → LOW
 * `unresolved_css`; it is not applied. Colour inheritance is not computed.
 */

import { Parser } from "htmlparser2";
import { ansiLayer } from "./ansi.js";
import type { FindingSet } from "./findings.js";
import { hasRtl, unicodeLayer } from "./unicode.js";

type Decls = Map<string, string>;

/** A simple-selector rule, remembered with its source order for the cascade. */
interface IndexedRule {
  order: number;
  decls: Decls;
}

interface CssIndex {
  type: Map<string, IndexedRule[]>;
  cls: Map<string, IndexedRule[]>;
  id: Map<string, IndexedRule[]>;
  size: number;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

const HTML_DETECT = /^\s*<(?:!doctype\s+html|html)\b/i;
const STYLE_OPEN = /<style\b[^>]{0,2000}>/gi;
const SIMPLE_SELECTOR = /^(?:[a-z][a-z0-9-]*|\.[\w-]+|#[\w-]+)$/i;
const HIDDEN_TEXT_SAMPLE = 200;

/** Treat content as HTML only on an explicit content type or a doctype/`<html>` prefix. */
export function isHtml(text: string, contentType?: string): boolean {
  if (typeof contentType === "string" && /^\s*text\/html\b/i.test(contentType)) return true;
  return HTML_DETECT.test(text);
}

function parseDecls(style: string): Decls {
  const decls: Decls = new Map();
  for (const part of style.split(";")) {
    const colon = part.indexOf(":");
    if (colon <= 0) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    const value = part
      .slice(colon + 1)
      .replace(/!\s*important/i, "")
      .trim()
      .toLowerCase();
    if (prop) decls.set(prop, value);
  }
  return decls;
}

const NAMED_COLORS: Record<string, string> = { white: "#ffffff", black: "#000000" };

function normalizeColor(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.replace(/\s+/g, "");
  if (NAMED_COLORS[v]) return NAMED_COLORS[v];
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const rgb = /^rgba?\((\d{1,3}),(\d{1,3}),(\d{1,3})(?:,[\d.]+%?)?\)$/.exec(v);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  }
  return v || undefined;
}

/** First colour-looking token of a `background` shorthand. */
function backgroundColor(decls: Decls): string | undefined {
  const explicit = decls.get("background-color");
  if (explicit) return normalizeColor(explicit);
  const shorthand = decls.get("background");
  if (!shorthand) return undefined;
  const token = /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b)/.exec(shorthand);
  return token ? normalizeColor(token[1]) : undefined;
}

function offscreenPx(value: string | undefined): boolean {
  if (!value) return false;
  const m = /^-(\d+(?:\.\d+)?)(px|em|rem)?$/.exec(value);
  if (!m) return false;
  const magnitude = Number(m[1]) * (m[2] === "em" || m[2] === "rem" ? 16 : 1);
  return magnitude >= 999;
}

/** The first hiding technique a declaration set uses, as a finding id, or null. */
function hidingReason(decls: Decls): string | null {
  if (decls.size === 0) return null;
  if (decls.get("display") === "none") return "html-display-none";
  const visibility = decls.get("visibility");
  if (visibility === "hidden" || visibility === "collapse") return "html-visibility-hidden";
  const fontSize = decls.get("font-size");
  if (fontSize !== undefined && /^0+(?:\.0*)?(?:px|pt|em|rem|%|ex|ch|vw|vh)?$/.test(fontSize)) {
    return "html-font-size-0";
  }
  const opacity = decls.get("opacity");
  if (opacity !== undefined && /^(?:0+(?:\.0*)?|\.0+|0+%)$/.test(opacity)) return "html-opacity-0";
  const fg = normalizeColor(decls.get("color"));
  if (fg !== undefined && fg === backgroundColor(decls)) return "html-color-match";
  const position = decls.get("position");
  if (
    (position === "absolute" || position === "fixed") &&
    ["left", "top", "right", "bottom"].some((side) => offscreenPx(decls.get(side)))
  ) {
    return "html-offscreen";
  }
  return null;
}

function addRule(map: Map<string, IndexedRule[]>, key: string, rule: IndexedRule): void {
  const list = map.get(key);
  if (list) list.push(rule);
  else map.set(key, [rule]);
}

/** Register one CSS rule: simple selectors into the index, complex hiding ones as `unresolved_css`. */
function indexRule(index: CssIndex, prelude: string, body: string, findings: FindingSet): void {
  const decls = parseDecls(body);
  const hides = hidingReason(decls) !== null;
  const rule: IndexedRule = { order: index.size++, decls };
  for (const selector of prelude.split(",").map((s) => s.trim())) {
    if (!selector) continue;
    if (!SIMPLE_SELECTOR.test(selector)) {
      if (hides) findings.add("unresolved_css", "low", `${selector} {${body}}`);
      continue;
    }
    if (selector.startsWith(".")) addRule(index.cls, selector.slice(1), rule);
    else if (selector.startsWith("#")) addRule(index.id, selector.slice(1), rule);
    else addRule(index.type, selector.toLowerCase(), rule);
  }
}

/**
 * Walk the innermost `prelude { body }` blocks of a stylesheet with linear
 * `indexOf` scans (a regex here retries from every offset on brace-free input).
 * Descends into `@media`-style wrappers; skips other at-rules.
 */
function forEachCssRule(css: string, visit: (prelude: string, body: string) => void): void {
  let start = 0;
  let close = -1;
  for (let open = css.indexOf("{"); open !== -1; open = css.indexOf("{", open + 1)) {
    if (close < open) close = css.indexOf("}", open + 1);
    if (close === -1) return;
    const nextOpen = css.indexOf("{", open + 1);
    if (nextOpen !== -1 && nextOpen < close) {
      start = open + 1; // wrapper block (e.g. @media): its rules follow
      continue;
    }
    // Drop anything before the last `;`/`}` (e.g. `@import …;`, a closed wrapper).
    const prelude = css.slice(start, open).split(/[;}]/).pop()?.trim() ?? "";
    if (prelude && !prelude.startsWith("@")) visit(prelude, css.slice(open + 1, close));
    start = close + 1;
  }
}

function buildCssIndex(src: string, findings: FindingSet): CssIndex {
  const index: CssIndex = { type: new Map(), cls: new Map(), id: new Map(), size: 0 };
  if (!/<style\b/i.test(src)) return index;
  const lower = src.toLowerCase();
  STYLE_OPEN.lastIndex = 0;
  for (let open = STYLE_OPEN.exec(src); open !== null; open = STYLE_OPEN.exec(src)) {
    const bodyStart = open.index + open[0].length;
    const bodyEnd = lower.indexOf("</style", bodyStart);
    if (bodyEnd === -1) break; // unclosed: no further complete stylesheet
    const css = src.slice(bodyStart, bodyEnd).replace(/\/\*[\s\S]*?\*\//g, "");
    forEachCssRule(css, (prelude, body) => indexRule(index, prelude, body, findings));
    STYLE_OPEN.lastIndex = bodyEnd;
  }
  return index;
}

/** Specificity ranks of the supported simple selectors. */
const TYPE_RANK = 0;
const CLASS_RANK = 1;
const ID_RANK = 2;

/** Stylesheet declarations applying to an element: specificity first, then source order. */
function cascade(name: string, attribs: Record<string, string>, css: CssIndex): Decls {
  const matched: Array<{ rank: number; rule: IndexedRule }> = [];
  const collect = (rank: number, rules: IndexedRule[] | undefined) => {
    for (const rule of rules ?? []) matched.push({ rank, rule });
  };
  collect(TYPE_RANK, css.type.get(name));
  for (const cls of new Set((attribs.class ?? "").split(/\s+/))) if (cls) collect(CLASS_RANK, css.cls.get(cls));
  if (attribs.id) collect(ID_RANK, css.id.get(attribs.id));
  matched.sort((x, y) => x.rank - y.rank || x.rule.order - y.rule.order);
  const decls: Decls = new Map();
  for (const { rule } of matched) for (const [k, v] of rule.decls) decls.set(k, v);
  return decls;
}

function elementReason(name: string, attribs: Record<string, string>, css: CssIndex): string | null {
  if (name === "script") return "html-script";
  if (Object.hasOwn(attribs, "hidden")) return "html-hidden-attr";
  const decls = css.size > 0 ? cascade(name, attribs, css) : new Map<string, string>();
  if (attribs.style) for (const [k, v] of parseDecls(attribs.style)) decls.set(k, v); // inline wins
  return hidingReason(decls);
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface OpenElement {
  name: string;
  start: number;
}

/**
 * Run the HTML layer. Returns the edited document when `apply` (strip/block),
 * else the source unchanged; findings are recorded in both cases. Throws only
 * if the parser itself throws (the caller falls back — test-plan #X3).
 */
export function htmlLayer(src: string, findings: FindingSet, apply: boolean): string {
  const css = buildCssIndex(src, findings);
  const rtl = hasRtl(src);
  const edits: Edit[] = [];
  const stack: OpenElement[] = [];
  let hidden: { depth: number; reason: string; hasText: boolean; sample: string } | null = null;
  let text: { start: number; end: number; decoded: string } | null = null;

  const flushText = () => {
    if (!text) return;
    const cleaned = ansiLayer(unicodeLayer(text.decoded, findings, rtl), findings);
    if (cleaned !== text.decoded) edits.push({ start: text.start, end: text.end, text: escapeText(cleaned) });
    text = null;
  };

  const parser: Parser = new Parser(
    {
      onopentag(name, attribs) {
        flushText();
        stack.push({ name, start: parser.startIndex });
        if (hidden) return;
        const reason = elementReason(name, attribs, css);
        if (reason) hidden = { depth: stack.length - 1, reason, hasText: false, sample: "" };
      },
      onclosetag(_name, isImplied) {
        flushText();
        const element = stack.pop();
        if (!element || !hidden || hidden.depth !== stack.length) return;
        // Implied close (sibling / parent close / EOF) ends at the trigger's start.
        const end = isImplied ? parser.startIndex : parser.endIndex + 1;
        if (hidden.hasText && end > element.start) {
          edits.push({ start: element.start, end, text: "" });
          findings.add(hidden.reason, "high", hidden.sample);
        }
        hidden = null;
      },
      ontext(chunk) {
        if (hidden) {
          if (/\S/.test(chunk)) hidden.hasText = true;
          if (hidden.sample.length < HIDDEN_TEXT_SAMPLE) hidden.sample += chunk;
          return;
        }
        if (stack[stack.length - 1]?.name === "style") return; // CSS text: never HTML-escape it
        if (text && parser.startIndex === text.end) {
          text.decoded += chunk;
          text.end = parser.endIndex + 1;
        } else {
          flushText();
          text = { start: parser.startIndex, end: parser.endIndex + 1, decoded: chunk };
        }
      },
      oncomment(data) {
        flushText();
        if (!/\S/.test(data)) return;
        if (hidden) {
          // A comment inside a hidden element is hidden content: the element goes.
          hidden.hasText = true;
          if (hidden.sample.length < HIDDEN_TEXT_SAMPLE) hidden.sample += data;
          return;
        }
        edits.push({ start: parser.startIndex, end: parser.endIndex + 1, text: "" });
        findings.add("html-comment", "high", data);
      },
      onprocessinginstruction() {
        flushText();
      },
      onend() {
        flushText();
      },
    },
    { decodeEntities: true },
  );
  parser.write(src);
  parser.end();

  if (!apply || edits.length === 0) return src;
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let last = 0;
  for (const edit of edits) {
    if (edit.start < last) continue; // defensive: never apply overlapping ranges
    out += src.slice(last, edit.start) + edit.text;
    last = edit.end;
  }
  return out + src.slice(last);
}

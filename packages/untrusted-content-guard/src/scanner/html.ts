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

interface CssIndex {
  type: Map<string, Decls>;
  cls: Map<string, Decls>;
  id: Map<string, Decls>;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

const HTML_DETECT = /^\s*<(?:!doctype\s+html|html)\b/i;
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const CSS_RULE = /([^{}]+)\{([^{}]*)\}/g;
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

function addRule(map: Map<string, Decls>, key: string, decls: Decls): void {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, new Map(decls));
    return;
  }
  for (const [k, v] of decls) existing.set(k, v);
}

/** Register one CSS rule: simple selectors into the index, complex hiding ones as `unresolved_css`. */
function indexRule(index: CssIndex, prelude: string, body: string, findings: FindingSet): void {
  const decls = parseDecls(body);
  const hides = hidingReason(decls) !== null;
  for (const selector of prelude.split(",").map((s) => s.trim())) {
    if (!selector) continue;
    if (!SIMPLE_SELECTOR.test(selector)) {
      if (hides) findings.add("unresolved_css", "low", `${selector} {${body}}`);
      continue;
    }
    if (selector.startsWith(".")) addRule(index.cls, selector.slice(1), decls);
    else if (selector.startsWith("#")) addRule(index.id, selector.slice(1), decls);
    else addRule(index.type, selector.toLowerCase(), decls);
  }
}

function buildCssIndex(src: string, findings: FindingSet): CssIndex {
  const index: CssIndex = { type: new Map(), cls: new Map(), id: new Map() };
  if (!/<style\b/i.test(src)) return index;
  STYLE_BLOCK.lastIndex = 0;
  for (let block = STYLE_BLOCK.exec(src); block !== null; block = STYLE_BLOCK.exec(src)) {
    const css = (block[1] as string).replace(/\/\*[\s\S]*?\*\//g, "");
    CSS_RULE.lastIndex = 0;
    for (let rule = CSS_RULE.exec(css); rule !== null; rule = CSS_RULE.exec(css)) {
      // Drop anything before the last `;` (e.g. `@import …;` preceding the selector).
      const prelude = (rule[1] as string).split(";").pop()?.trim() ?? "";
      if (prelude && !prelude.startsWith("@")) indexRule(index, prelude, rule[2] as string, findings);
    }
  }
  return index;
}

function elementReason(name: string, attribs: Record<string, string>, css: CssIndex): string | null {
  if (name === "script") return "html-script";
  if (Object.hasOwn(attribs, "hidden")) return "html-hidden-attr";
  const decls: Decls = new Map();
  const merge = (d: Decls | undefined) => {
    if (d) for (const [k, v] of d) decls.set(k, v);
  };
  merge(css.type.get(name));
  for (const cls of (attribs.class ?? "").split(/\s+/)) if (cls) merge(css.cls.get(cls));
  if (attribs.id) merge(css.id.get(attribs.id));
  if (attribs.style) merge(parseDecls(attribs.style));
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
        if (hidden || !/\S/.test(data)) return;
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

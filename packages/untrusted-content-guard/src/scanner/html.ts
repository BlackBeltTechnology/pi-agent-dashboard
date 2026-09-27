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
 *   3. a URL-bearing attribute whose DECODED value is a `data:` URL → only that
 *      value's source range is replaced by a quoted placeholder.
 * Every other byte stays identical. URL checks (data:, tracking images,
 * confusables) run here on decoded attributes, decoded `<a>` text and each
 * decoded text node — never on the serialized document (design D1 amendment).
 *
 * Styles come from inline `style` and from embedded `<style>` rules whose
 * selector is a single type, `.class` or `#id` (or a comma list of those).
 * A more complex selector in a rule that sets a hiding property → LOW
 * `unresolved_css`; it is not applied. Colour inheritance is not computed.
 */

import { Parser } from "htmlparser2";
import { ansiLayer } from "./ansi.js";
import { buildCssIndex, type CssIndex, hidingReason, resolveDecls } from "./css.js";
import type { FindingSet } from "./findings.js";
import { hasRtl, unicodeLayer } from "./unicode.js";
import { checkConfusable, checkImage, dataUrlPlaceholder, hostOf, urlLayer } from "./url.js";

interface Edit {
  start: number;
  end: number;
  text: string;
}

const HTML_DETECT = /^\s*<(?:!doctype\s+html|html)\b/i;
const HIDDEN_TEXT_SAMPLE = 200;
const ANCHOR_TEXT_MAX = 1000;
/** Attributes whose (decoded) value is a URL. */
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "poster", "background", "cite", "data", "xlink:href"]);

/** Treat content as HTML only on an explicit content type or a doctype/`<html>` prefix. */
export function isHtml(text: string, contentType?: string): boolean {
  if (typeof contentType === "string" && /^\s*text\/html\b/i.test(contentType)) return true;
  return HTML_DETECT.test(text);
}

/**
 * Prepass: text of REAL `<style>` elements, as the parser sees them — never a
 * regex over raw source, so a `<style>` inside a script string is not a
 * stylesheet and a `</stylex>` inside CSS does not end one.
 */
function collectStylesheets(src: string): string[] {
  if (!/<style\b/i.test(src)) return [];
  const sheets: string[] = [];
  let depth = 0;
  let current = "";
  const parser = new Parser(
    {
      onopentag(name) {
        if (name === "style" && depth++ === 0) current = "";
      },
      ontext(chunk) {
        if (depth > 0) current += chunk;
      },
      onclosetag(name) {
        if (name === "style" && depth > 0 && --depth === 0) sheets.push(current);
      },
    },
    { decodeEntities: true },
  );
  parser.write(src);
  parser.end();
  return sheets;
}

function elementReason(name: string, attribs: Record<string, string>, css: CssIndex): string | null {
  if (name === "script") return "html-script";
  if (Object.hasOwn(attribs, "hidden")) return "html-hidden-attr";
  return hidingReason(resolveDecls(name, attribs, css));
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface HiddenElement {
  depth: number;
  reason: string;
  hasText: boolean;
  sample: string;
}

/** Record content found inside a hidden element (any non-whitespace makes it removable). */
function noteHidden(hidden: HiddenElement, content: string): void {
  if (/\S/.test(content)) hidden.hasText = true;
  if (hidden.sample.length < HIDDEN_TEXT_SAMPLE) hidden.sample += content;
}

/** Apply non-overlapping source-range edits; everything between them is copied byte-for-byte. */
function applyEdits(src: string, edits: Edit[]): string {
  if (edits.length === 0) return src;
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

interface OpenElement {
  name: string;
  start: number;
  /** This element opened the outermost tracked `<a>`. */
  anchor?: boolean;
}

const isSpace = (ch: string | undefined) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
const endsName = (ch: string | undefined) => isSpace(ch) || ch === "/" || ch === ">" || ch === "=";

/** First index in [i, end) where `stop` holds (or `end`). */
function skipUntil(src: string, i: number, end: number, stop: (ch: string | undefined) => boolean): number {
  let j = i;
  while (j < end && !stop(src[j])) j++;
  return j;
}

/** End (exclusive) of an attribute value starting at `i`: a quoted string or an unquoted run. */
function valueEnd(src: string, i: number, end: number): number {
  const quote = src[i];
  if (quote !== '"' && quote !== "'") return skipUntil(src, i, end, (ch) => isSpace(ch) || ch === ">");
  const close = src.indexOf(quote, i + 1);
  return close === -1 || close >= end ? end : close + 1;
}

/**
 * Source range of the FIRST occurrence of `attr`'s value inside the open tag
 * `src[tagStart, tagEnd)` (quotes included) — a quote-aware walk, so text that
 * merely looks like an attribute inside another quoted value never matches.
 * First occurrence wins, as in htmlparser2.
 */
function attributeValueRange(src: string, tagStart: number, tagEnd: number, attr: string): { start: number; end: number } | null {
  let i = skipUntil(src, tagStart + 1, tagEnd, (ch) => isSpace(ch) || ch === "/" || ch === ">"); // tag name
  while (i < tagEnd) {
    i = skipUntil(src, i, tagEnd, (ch) => !isSpace(ch) && ch !== "/");
    if (i >= tagEnd || src[i] === ">") return null;
    const nameEnd = skipUntil(src, i, tagEnd, endsName);
    const name = src.slice(i, nameEnd).toLowerCase();
    i = skipUntil(src, nameEnd, tagEnd, (ch) => !isSpace(ch));
    if (src[i] !== "=") {
      if (name === attr) return null; // valueless first occurrence
      continue;
    }
    const start = skipUntil(src, i + 1, tagEnd, (ch) => !isSpace(ch));
    i = valueEnd(src, start, tagEnd);
    if (name === attr) return { start, end: i };
  }
  return null;
}

/**
 * URL checks on an element's DECODED attributes (design D1 amendment): a
 * `data:` value → HIGH `data-url` + a value-only edit; `<img src>` →
 * tracking-image; any absolute URL host → confusable.
 */
function checkAttributes(
  src: string,
  tag: { name: string; start: number; end: number; attribs: Record<string, string> },
  allowHosts: readonly string[],
  findings: FindingSet,
  edits: Edit[],
): void {
  for (const [attr, value] of Object.entries(tag.attribs)) {
    if (!URL_ATTRIBUTES.has(attr)) continue;
    const placeholder = dataUrlPlaceholder(value);
    if (placeholder) {
      findings.add("data-url", "high", value.slice(0, 60));
      const range = attributeValueRange(src, tag.start, tag.end, attr);
      if (range) edits.push({ ...range, text: `"${placeholder}"` });
      continue;
    }
    if (tag.name === "img" && attr === "src") checkImage(value, allowHosts, findings);
    const host = hostOf(value);
    if (host) checkConfusable(host, findings);
  }
}

/**
 * Run the HTML layer. Returns the edited document when `apply` (strip/block),
 * else the source unchanged; findings are recorded in both cases. Throws only
 * if the parser itself throws (the caller falls back — test-plan #X3).
 */
export function htmlLayer(
  src: string,
  findings: FindingSet,
  opts: { apply: boolean; allowHosts: readonly string[] },
): string {
  const css = buildCssIndex(collectStylesheets(src), findings);
  const rtl = hasRtl(src);
  const edits: Edit[] = [];
  const stack: OpenElement[] = [];
  let hidden: HiddenElement | null = null;
  let text: { start: number; end: number; decoded: string } | null = null;
  let anchorText: string | null = null;

  const flushText = () => {
    if (!text) return;
    const plain = ansiLayer(unicodeLayer(text.decoded, findings, rtl), findings);
    const cleaned = urlLayer(plain, findings, { replaceData: true, allowHosts: opts.allowHosts });
    if (cleaned !== text.decoded) edits.push({ start: text.start, end: text.end, text: escapeText(cleaned) });
    text = null;
  };

  const parser: Parser = new Parser(
    {
      onopentag(name, attribs) {
        flushText();
        const element: OpenElement = { name, start: parser.startIndex };
        stack.push(element);
        if (!hidden) {
          const reason = elementReason(name, attribs, css);
          if (reason) hidden = { depth: stack.length - 1, reason, hasText: false, sample: "" };
        }
        // Also inside hidden markup: a hidden element without text is NOT removed,
        // so its URLs must still be neutralised. Edits under a removed range are
        // dropped as overlapping by applyEdits.
        const tag = { name, start: parser.startIndex, end: parser.endIndex + 1, attribs };
        checkAttributes(src, tag, opts.allowHosts, findings, edits);
        if (!hidden && name === "a" && anchorText === null) {
          anchorText = "";
          element.anchor = true;
        }
      },
      onclosetag(_name, isImplied) {
        flushText();
        const element = stack.pop();
        if (element?.anchor && anchorText !== null) {
          checkConfusable(anchorText, findings);
          anchorText = null;
        }
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
          noteHidden(hidden, chunk);
          return;
        }
        if (stack[stack.length - 1]?.name === "style") return; // CSS text: never HTML-escape it
        if (anchorText !== null && anchorText.length < ANCHOR_TEXT_MAX) anchorText += chunk;
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
          noteHidden(hidden, data); // a comment inside a hidden element is hidden content
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

  return opts.apply ? applyEdits(src, edits) : src;
}

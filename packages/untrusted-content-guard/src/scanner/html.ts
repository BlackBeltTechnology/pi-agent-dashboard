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
import { buildCssIndex, type CssIndex, hidingReason, resolveDecls } from "./css.js";
import type { FindingSet } from "./findings.js";
import { hasRtl, unicodeLayer } from "./unicode.js";

interface Edit {
  start: number;
  end: number;
  text: string;
}

const HTML_DETECT = /^\s*<(?:!doctype\s+html|html)\b/i;
const HIDDEN_TEXT_SAMPLE = 200;

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
  const css = buildCssIndex(collectStylesheets(src), findings);
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

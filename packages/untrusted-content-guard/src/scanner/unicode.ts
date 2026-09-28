/**
 * Unicode layer — invisible / format characters (design D1 table, row `unicode`).
 *
 * High (removed in strip/block): zero-width chars, tag chars U+E0000–E007F,
 * variation-selector runs ≥ 2 or a VS on a non-emoji base, and BIDI
 * embed/override/isolate controls in text with NO strong-RTL characters.
 *
 * Preserved (no finding): ZWJ/ZWNJ inside emoji sequences or Brahmic/Arabic
 * clusters, ZWSP adjacent to Thai/Lao/Khmer/Myanmar/CJK, LRM/RLM (never matched).
 * BIDI controls in RTL-bearing text: low finding, kept.
 *
 * Never decodes character references — callers hand it decoded text (HTML text
 * nodes) or raw plain text, where a literal `&#8203;` is harmless visible text.
 */

import type { FindingSet } from "./findings.js";

/** Cheap pre-filter: any code unit this layer could act on. U+DB40 = tags/VS supplement high surrogate. */
const PREFILTER = /[\u180E\u200B-\u200D\u202A-\u202E\u2060-\u2069\uFEFF\uFE00-\uFE0F\uDB40]/;

const CANDIDATES =
  /([\u200B-\u200D\u2060-\u2064\uFEFF\u180E]+)|([\u202A-\u202E\u2066-\u2069]+)|([\u{E0000}-\u{E007F}]+)|([\uFE00-\uFE0F\u{E0100}-\u{E01EF}]+)/gu;

const RTL =
  /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}]/u;

/** Scripts whose shaping legitimately uses ZWJ / ZWNJ inside a cluster. */
const CLUSTER_SCRIPT =
  /[\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}\p{Script=Mongolian}]/u;

/** Scripts written without inter-word spaces, where ZWSP marks word breaks. */
const SPACELESS_SCRIPT =
  /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u;

/** Characters that may precede a ZWJ inside an emoji sequence. */
const EMOJI_SEQ_PREV = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u20E3]/u;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const EMOJI_BASE = /\p{Emoji}/u;

const ZWSP = 0x200b;
const ZWNJ = 0x200c;
const ZWJ = 0x200d;

function test(re: RegExp, cp: number | undefined): boolean {
  return cp !== undefined && re.test(String.fromCodePoint(cp));
}

function cpBefore(text: string, index: number): number | undefined {
  if (index === 0) return undefined;
  const unit = text.charCodeAt(index - 1);
  if (unit >= 0xdc00 && unit <= 0xdfff && index >= 2) return text.codePointAt(index - 2);
  return unit;
}

function preservedZeroWidth(run: string, prev: number | undefined, next: number | undefined): boolean {
  if (run.length !== 1) return false;
  const cp = run.charCodeAt(0);
  if (cp === ZWJ || cp === ZWNJ) {
    if (test(EMOJI_SEQ_PREV, prev) && test(PICTOGRAPHIC, next)) return true;
    // Inside a cluster: both neighbours belong to a joining script (never a script boundary).
    return test(CLUSTER_SCRIPT, prev) && test(CLUSTER_SCRIPT, next);
  }
  if (cp === ZWSP) return test(SPACELESS_SCRIPT, prev) || test(SPACELESS_SCRIPT, next);
  return false;
}

export function hasRtl(text: string): boolean {
  return RTL.test(text);
}

/**
 * Classify one candidate run, recording its finding. Returns true when the run
 * must be removed (high severity).
 */
function classify(m: RegExpExecArray, prev: number | undefined, next: number | undefined, rtl: boolean, findings: FindingSet): boolean {
  if (m[1] !== undefined) {
    if (preservedZeroWidth(m[1], prev, next)) return false;
    findings.add("unicode-zero-width", "high", m[1]);
    return true;
  }
  if (m[2] !== undefined) {
    findings.add(rtl ? "unicode-bidi-rtl" : "unicode-bidi", rtl ? "low" : "high", m[2]);
    return !rtl;
  }
  if (m[3] !== undefined) {
    findings.add("unicode-tags", "high", m[3]);
    return true;
  }
  const run = m[4] as string;
  if ([...run].length < 2 && test(EMOJI_BASE, prev)) return false;
  findings.add("unicode-variation-selectors", "high", run);
  return true;
}

/**
 * Scan `text`, record findings, and return the cleaned text (high-severity
 * spans removed). `rtlContext` overrides the RTL test (HTML passes the whole
 * document's answer so a control in its own text node is judged in context).
 */
export function unicodeLayer(text: string, findings: FindingSet, rtlContext?: boolean): string {
  if (!PREFILTER.test(text)) return text;
  const rtl = rtlContext ?? hasRtl(text);
  let out = "";
  let last = 0;
  CANDIDATES.lastIndex = 0;
  for (let m = CANDIDATES.exec(text); m !== null; m = CANDIDATES.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    if (classify(m, cpBefore(text, start), text.codePointAt(end), rtl, findings)) {
      out += text.slice(last, start);
      last = end;
    }
  }
  return last === 0 ? text : out + text.slice(last);
}

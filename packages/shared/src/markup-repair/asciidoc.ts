/**
 * AsciiDoc markup repair — pure line scanner (no asciidoctor import) shared by the
 * server (display) and the client (apply).
 *
 *  - A1: bare `[mermaid…]` style on a `----` / `....` block → `[source,mermaid…]`
 *  - A2: unterminated top-level `----` / `....` block → close it
 *
 * Idempotent; changes no bytes outside replaced / inserted lines; `line` numbers refer
 * to the ORIGINAL source. See change: add-md-adoc-markup-repair.
 */
import type { MarkupRepair, MarkupRepairResult } from "./types.js";

interface Line {
  text: string; // without terminator
  eol: string; // "\n", "\r\n" or ""
}

const A1_RE = /^\[mermaid(,[^\]]*)?\][ \t]*$/;
const PRELUDE_RE = /^(\.[^.\s].*|\[\[.*\]\]|\[#.*\]|\[.*\])$/;
const LISTING_RE = /^(-{4,}|\.{4,})$/;
const VERBATIM_RE = /^(-{4,}|\.{4,}|\/{4,}|\+{4,})$/;
const STRUCTURAL_RE = /^(={4,}|\*{4,}|_{4,}|--|[|,:!]={3,})$/;
const SECTION_RE = /^={1,6}[ \t]+\S/;
const BLANK_RE = /^[ \t]*$/;

function splitLines(src: string): Line[] {
  const out: Line[] = [];
  const re = /[^\n]*\n|[^\n]+$/g;
  for (const m of src.matchAll(re)) {
    const raw = m[0];
    const text = raw.replace(/\r?\n$/, "");
    out.push({ text, eol: raw.slice(text.length) });
  }
  return out;
}

const join = (lines: Line[]): string => lines.map((l) => l.text + l.eol).join("");

/** A1: index of the `----`/`....` opener the `[mermaid…]` attribute line at `i` applies to, else -1. */
function a1Opener(lines: Line[], i: number): number {
  if (!A1_RE.test(lines[i].text)) return -1;
  let j = i + 1;
  while (j < lines.length && PRELUDE_RE.test(lines[j].text)) j++;
  return j < lines.length && LISTING_RE.test(lines[j].text) ? j : -1;
}

type A2Fix = { kind: "replace"; at: number } | { kind: "insert"; before: number } | null;

/**
 * A2: how to close the unterminated listing/literal block opened at `i` (delimiter `t`), if at all.
 * The look-alike delimiter is only searched BEFORE the next blank+section-title boundary: past it,
 * it would be the opener of a later, properly closed sibling block.
 */
function a2Fix(lines: Line[], i: number, t: string): A2Fix {
  let boundary = -1;
  for (let x = i + 2; x < lines.length; x++) {
    if (SECTION_RE.test(lines[x].text) && BLANK_RE.test(lines[x - 1].text)) {
      boundary = x - 1;
      break;
    }
  }
  const limit = boundary === -1 ? lines.length : boundary;
  const ch = t[0];
  for (let x = i + 1; x < limit; x++) {
    const lt = lines[x].text;
    if (lt.length >= 4 && lt.length !== t.length && lt === ch.repeat(lt.length)) return { kind: "replace", at: x };
  }
  return boundary === -1 ? null : { kind: "insert", before: boundary };
}

export function repairAsciiDoc(src: string): MarkupRepairResult {
  const lines = splitLines(src);
  const n = lines.length;
  const out: Line[] = [];
  const repairs: MarkupRepair[] = [];
  const stack: string[] = [];
  const copy = (from: number, to: number): void => {
    for (let x = from; x < to; x++) out.push(lines[x]);
  };
  let i = 0;

  while (i < n) {
    const line = lines[i];
    const t = line.text;

    if (a1Opener(lines, i) >= 0) {
      out.push({ text: `[source,${t.slice(1)}`, eol: line.eol });
      repairs.push({ rule: "A1", line: i + 1 });
      i++;
      continue;
    }

    if (VERBATIM_RE.test(t)) {
      let k = i + 1;
      while (k < n && lines[k].text !== t) k++;
      if (k < n) {
        copy(i, k + 1);
        i = k + 1;
        continue;
      }
      // Unterminated. Nested blocks, list-attached blocks and comment/passthrough are left alone.
      const nested = stack.length > 0 || (i > 0 && lines[i - 1].text === "+");
      const fix = nested || !LISTING_RE.test(t) ? null : a2Fix(lines, i, t);
      if (!fix) {
        copy(i, n);
        break;
      }
      repairs.push({ rule: "A2", line: i + 1 });
      if (fix.kind === "replace") {
        copy(i, fix.at);
        out.push({ text: t, eol: lines[fix.at].eol });
        i = fix.at + 1;
      } else {
        copy(i, fix.before);
        out.push({ text: t, eol: line.eol });
        i = fix.before;
      }
      continue;
    }

    if (STRUCTURAL_RE.test(t)) {
      if (stack[stack.length - 1] === t) stack.pop();
      else stack.push(t);
    }
    out.push(line);
    i++;
  }

  return repairs.length === 0 ? { source: src, repairs } : { source: join(out), repairs };
}

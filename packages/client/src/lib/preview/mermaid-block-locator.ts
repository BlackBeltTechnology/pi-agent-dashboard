/**
 * Locate / verify / splice the Nth mermaid block of a raw file — the pure core
 * of "Apply fix to file". Three formats:
 *
 *  - `md`   — re-parse with the renderer's own remark plugin list
 *             (`MARKDOWN_REMARK_PLUGINS`) and index the fenced `mermaid` code
 *             nodes (`collectMermaidCodeNodes`, the same list the preview stamps).
 *  - `adoc` — line scanner: `[source,mermaid(,…)?]` + a `----`/`....` delimiter
 *             pair; the located count must equal the preview's (`expectedCount`).
 *  - `mmd`  — the whole file is the block.
 *
 * Blocks that cannot be rewritten safely (fence inside a container line such as
 * a blockquote or list marker, unclosed fence, fixed source that would close the
 * fence early) report `not-applicable`. A splice touches ONLY the lines between
 * the fence/delimiter lines; everything else is byte-identical.
 *
 * Imported lazily (apply click) so `unified`/`remark-parse` stay out of the
 * entry chunk. See change: add-preview-apply-fix-to-file (design D1–D3).
 */
import remarkParse from "remark-parse";
import { unified } from "unified";
import { MARKDOWN_REMARK_PLUGINS } from "./markdown-remark-plugins.js";
import type { MermaidFileKind } from "./mermaid-source-context.js";
import { collectMermaidCodeNodes, type MdNode } from "./remark-mermaid-ordinal.js";

type LocateFailure = "not-found" | "not-applicable";

interface LocatedMermaidBlock {
  ok: true;
  kind: MermaidFileKind;
  ordinal: number;
  /** Block content as it sits on disk (md: mdast `code.value`; adoc: inner lines joined by `\n`; mmd: file text). */
  value: string;
  /** Number of mermaid blocks found in the file (same detection as the preview). */
  count: number;
  /** Whole-file text with the block content replaced by `fixed`; `null` when that cannot be done safely. */
  replace: (fixed: string) => string | null;
}

type LocateResult = LocatedMermaidBlock | { ok: false; reason: LocateFailure };

interface LocateOptions {
  /** AsciiDoc only: the number of mermaid blocks the preview rendered. */
  expectedCount?: number;
}

const BOM = "\uFEFF";
const NOT_FOUND: LocateResult = { ok: false, reason: "not-found" };
const NOT_APPLICABLE: LocateResult = { ok: false, reason: "not-applicable" };

interface Line {
  /** Offset of the first char of the line. */
  start: number;
  /** Offset of the line terminator (== end of content). */
  contentEnd: number;
  /** Terminator text ("" for an unterminated last line). */
  eol: string;
  text: string;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  const re = /\r\n|\n|\r/g;
  let start = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    lines.push({ start, contentEnd: m.index, eol: m[0], text: text.slice(start, m.index) });
    start = m.index + m[0].length;
  }
  lines.push({ start, contentEnd: text.length, eol: "", text: text.slice(start) });
  return lines;
}

/** Fixed source as LF-split lines, one trailing newline dropped. */
function fixedLinesOf(fixed: string): string[] {
  if (fixed === "") return [];
  return fixed.replace(/\r?\n$/, "").split(/\r\n|\n|\r/);
}

function splitBom(file: string): { bom: string; text: string } {
  return file.startsWith(BOM) ? { bom: BOM, text: file.slice(1) } : { bom: "", text: file };
}

// ── markdown ────────────────────────────────────────────────────────────────

const FENCE_OPEN_RE = /^([ \t]*)(`{3,}|~{3,})/;

function locateMd(text: string, ordinal: number): LocateResult {
  const tree = unified().use(remarkParse).use(MARKDOWN_REMARK_PLUGINS).parse(text) as unknown as MdNode;
  const nodes = collectMermaidCodeNodes(tree);
  const node = nodes[ordinal];
  if (!node?.position) return NOT_FOUND;

  const lines = splitLines(text);
  const openIdx = node.position.start.line - 1;
  const closeIdx = node.position.end.line - 1;
  const opener = lines[openIdx];
  const closer = lines[closeIdx];
  if (!opener || !closer || closeIdx <= openIdx) return NOT_APPLICABLE; // unclosed / degenerate

  // The opener line must hold ONLY indentation before the fence marker: a
  // blockquote `>` or a list marker on the same line cannot be re-indented safely.
  const open = FENCE_OPEN_RE.exec(opener.text);
  if (!open) return NOT_APPLICABLE;
  const [, indent, marker] = open;
  const closerRe = new RegExp(`^[ \\t]*${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`);
  if (!closerRe.test(closer.text)) return NOT_APPLICABLE; // ran to EOF: no closing fence

  const innerStart = lines[openIdx + 1].start;
  const innerEnd = closer.start;
  const eol = opener.eol || "\n";
  const value = node.value ?? "";

  return {
    ok: true,
    kind: "md",
    ordinal,
    value,
    count: nodes.length,
    replace: (fixed) => {
      if (fixed === value) return text;
      const fixedLines = fixedLinesOf(fixed);
      if (fixedLines.some((l) => closerRe.test(l))) return null; // would close the fence early
      const inner = fixedLines.map((l) => (l.trim() === "" ? "" : indent + l)).join(eol);
      return text.slice(0, innerStart) + (inner ? inner + eol : "") + text.slice(innerEnd);
    },
  };
}

// ── AsciiDoc ────────────────────────────────────────────────────────────────

const ADOC_ATTR_RE = /^\[source\s*,\s*mermaid\s*(?:,[^\]]*)?\]\s*$/i;
const ADOC_DELIM_RE = /^(-{4,}|\.{4,})\s*$/;

interface AdocBlock {
  openIdx: number;
  closeIdx: number; // -1 when unclosed
  delim: string;
}

function scanAdoc(lines: Line[]): AdocBlock[] {
  const blocks: AdocBlock[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!ADOC_ATTR_RE.test(lines[i].text)) continue;
    const d = ADOC_DELIM_RE.exec(lines[i + 1].text);
    if (!d) continue;
    const delim = d[1];
    let closeIdx = -1;
    for (let j = i + 2; j < lines.length; j++) {
      if (lines[j].text.trimEnd() === delim) {
        closeIdx = j;
        break;
      }
    }
    blocks.push({ openIdx: i + 1, closeIdx, delim });
    if (closeIdx === -1) break;
    i = closeIdx;
  }
  return blocks;
}

function locateAdoc(text: string, ordinal: number, opts: LocateOptions): LocateResult {
  const lines = splitLines(text);
  const blocks = scanAdoc(lines);
  const block = blocks[ordinal];
  if (!block) return NOT_FOUND;
  if (opts.expectedCount !== undefined && blocks.length !== opts.expectedCount) return NOT_APPLICABLE;
  if (block.closeIdx === -1) return NOT_APPLICABLE;

  const opener = lines[block.openIdx];
  const innerLines = lines.slice(block.openIdx + 1, block.closeIdx);
  const value = innerLines.map((l) => l.text).join("\n");
  const innerStart = lines[block.openIdx + 1].start;
  const innerEnd = lines[block.closeIdx].start;
  const eol = opener.eol || "\n";

  return {
    ok: true,
    kind: "adoc",
    ordinal,
    value,
    count: blocks.length,
    replace: (fixed) => {
      if (fixed === value) return text;
      const fixedLines = fixedLinesOf(fixed);
      if (fixedLines.some((l) => l.trimEnd() === block.delim)) return null; // would close the block early
      return text.slice(0, innerStart) + (fixedLines.length ? fixedLines.join(eol) + eol : "") + text.slice(innerEnd);
    },
  };
}

// ── .mmd / .mermaid (whole file) ────────────────────────────────────────────

function locateMmd(bom: string, text: string, ordinal: number): LocateResult {
  if (ordinal !== 0) return NOT_FOUND;
  const firstEol = /\r\n|\n|\r/.exec(text)?.[0] ?? "\n";
  const endsWithEol = /(?:\r\n|\n|\r)$/.test(text);
  return {
    ok: true,
    kind: "mmd",
    ordinal: 0,
    value: text,
    count: 1,
    replace: (fixed) => {
      if (fixed === text) return bom + text;
      const body = fixedLinesOf(fixed).join(firstEol);
      return bom + body + (endsWithEol && body !== "" ? firstEol : "");
    },
  };
}

// ── public API ──────────────────────────────────────────────────────────────

/** Locate mermaid block `ordinal` of `file`. Never throws on malformed input. */
export function locateMermaidBlock(
  file: string,
  kind: MermaidFileKind,
  ordinal: number,
  opts: LocateOptions = {},
): LocateResult {
  const { bom, text } = splitBom(file);
  let result: LocateResult;
  try {
    if (kind === "md") result = locateMd(text, ordinal);
    else if (kind === "adoc") result = locateAdoc(text, ordinal, opts);
    else result = locateMmd(bom, text, ordinal);
  } catch {
    return NOT_APPLICABLE;
  }
  if (!result.ok || kind === "mmd" || !bom) return result;
  const inner = result.replace;
  return { ...result, replace: (fixed) => {
    const out = inner(fixed);
    return out === null ? null : bom + out;
  } };
}

/**
 * True iff the located block, passed through the SAME display transform its
 * surface applies, equals the source the preview rendered. Proves "same
 * block"; the diff still shows the real bytes before confirm.
 *
 *  - md / mmd: identity (fenced content is literal; `.mmd` is rendered as read).
 *  - adoc: `trim()` (the splitter trims the decoded `<code>` text). Asciidoctor
 *    substitutions (callouts, attribute refs) yield a mismatch → abort, the safe direction.
 */
export function verifyMermaidBlock(located: LocatedMermaidBlock, displayed: string): boolean {
  if (located.kind === "adoc") return located.value.trim() === displayed.trim();
  // `.mmd`: the viewer's text may keep a leading BOM that `locate` strips from `value`.
  return located.value === (located.kind === "mmd" ? displayed.replace(/^\uFEFF/, "") : displayed);
}

/** `file` with block `ordinal` replaced by `fixed`, or `null` when not located / not applicable. */
export function spliceMermaidBlock(
  file: string,
  kind: MermaidFileKind,
  ordinal: number,
  fixed: string,
  opts: LocateOptions = {},
): string | null {
  const located = locateMermaidBlock(file, kind, ordinal, opts);
  return located.ok ? located.replace(fixed) : null;
}

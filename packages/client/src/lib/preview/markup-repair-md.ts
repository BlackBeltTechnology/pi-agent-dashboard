/**
 * Markdown markup repair for FILE previews (never chat/streaming).
 *
 * Candidates = top-level fenced `code` nodes of the renderer's own mdast parse
 * (`MARKDOWN_REMARK_PLUGINS`, so frontmatter is a `yaml` node and quoted / listed
 * fences are never root children) that no later line closes.
 *  - M2: the first look-alike closer (other fence char, or same char but shorter)
 *        is REPLACED by a valid closer.
 *  - M3: else a closer is INSERTED before the blank line preceding the first ATX heading.
 *
 * Pure, idempotent; touches only the replaced / inserted lines; `line` refers to the
 * ORIGINAL source. See change: add-md-adoc-markup-repair (design D1/D2).
 */
import type { MarkupRepair, MarkupRepairResult } from "@blackbelt-technology/pi-dashboard-shared/markup-repair/types.js";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { MARKDOWN_REMARK_PLUGINS } from "./markdown-remark-plugins.js";
import type { MdNode } from "./remark-mermaid-ordinal.js";

interface Line {
  text: string;
  eol: string;
}

const FENCE_ANY_RE = /^( {0,3})(`{3,}|~{3,})/;
const FENCE_LINE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HEADING_RE = /^ {0,3}#{1,6}[ \t]+\S/;
const BLANK_RE = /^[ \t]*$/;

function splitLines(src: string): Line[] {
  const out: Line[] = [];
  for (const m of src.matchAll(/[^\n]*\n|[^\n]+$/g)) {
    const text = m[0].replace(/\r?\n$/, "");
    out.push({ text, eol: m[0].slice(text.length) });
  }
  return out;
}

const join = (lines: Line[]): string => lines.map((l) => l.text + l.eol).join("");

const parser = unified().use(remarkParse).use(MARKDOWN_REMARK_PLUGINS);

/** 0-based opener lines of top-level fenced code nodes, in document order. */
function topLevelFenceOpeners(src: string, lines: Line[]): number[] {
  const root = parser.parse(src) as unknown as MdNode;
  const out: number[] = [];
  for (const child of root.children ?? []) {
    if (child.type !== "code" || !child.position) continue;
    const idx = child.position.start.line - 1;
    if (lines[idx] && FENCE_ANY_RE.test(lines[idx].text)) out.push(idx);
  }
  return out;
}

/** True when a later line closes the fence (same char, length ≥ opener, ≤3 indent, only trailing whitespace). */
function isClosed(lines: Line[], opener: number, ch: string, length: number): boolean {
  for (let x = opener + 1; x < lines.length; x++) {
    const m = FENCE_LINE_RE.exec(lines[x].text);
    if (m && m[1][0] === ch && m[1].length >= length) return true;
  }
  return false;
}

type Fix = { rule: "M2"; at: number } | { rule: "M3"; before: number } | null;

/** M2 (replace the first look-alike closer) else M3 (insert before the blank line preceding a heading). */
function planFix(lines: Line[], opener: number): Fix {
  for (let x = opener + 1; x < lines.length; x++) {
    if (FENCE_LINE_RE.test(lines[x].text)) return { rule: "M2", at: x };
  }
  for (let x = opener + 2; x < lines.length; x++) {
    if (HEADING_RE.test(lines[x].text) && BLANK_RE.test(lines[x - 1].text)) return { rule: "M3", before: x - 1 };
  }
  return null;
}

/** One repair of the first repairable unterminated top-level fence beyond `after`; null when none. */
function repairNext(lines: Line[], after: number): { lines: Line[]; rule: "M2" | "M3"; opener: number; at: number } | null {
  for (const opener of topLevelFenceOpeners(join(lines), lines).filter((o) => o > after)) {
    const open = FENCE_ANY_RE.exec(lines[opener].text);
    if (!open) continue;
    const [, indent, marker] = open;
    // Properly closed, or nothing follows the opener: never repaired.
    if (opener === lines.length - 1 || isClosed(lines, opener, marker[0], marker.length)) continue;

    const fix = planFix(lines, opener);
    if (!fix) return null; // unrepairable unterminated fence swallows the rest of the file
    const closer = indent + marker[0].repeat(marker.length);
    if (fix.rule === "M2") {
      const next = lines.map((l, i) => (i === fix.at ? { text: closer, eol: l.eol } : l));
      return { lines: next, rule: "M2", opener, at: fix.at };
    }
    const next = [...lines.slice(0, fix.before), { text: closer, eol: lines[opener].eol }, ...lines.slice(fix.before)];
    return { lines: next, rule: "M3", opener, at: fix.before };
  }
  return null;
}

export function repairMarkdown(src: string): MarkupRepairResult {
  if (!/^ {0,3}(`{3,}|~{3,})/m.test(src)) return { source: src, repairs: [] };

  let lines = splitLines(src);
  const repairs: MarkupRepair[] = [];
  let inserted = 0;
  let after = -1; // only consider openers beyond the previous repair's closer

  for (let step = repairNext(lines, after); step; step = repairNext(lines, after)) {
    repairs.push({ rule: step.rule, line: step.opener + 1 - inserted });
    if (step.rule === "M3") inserted++;
    lines = step.lines;
    after = step.at;
  }

  return repairs.length === 0 ? { source: src, repairs } : { source: join(lines), repairs };
}

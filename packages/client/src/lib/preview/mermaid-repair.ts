// Deterministic rule-based repair for mermaid sources that failed to render.
// Pure: no DOM, no mermaid import. TS port derived from the
// mermaid-md-doctor skill's fix.py, with the deliberate fixes of design D2.
// See change: add-mermaid-auto-repair.

export type RuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7";

export interface RepairResult {
  code: string;
  applied: RuleId[];
}

type Kind = "flowchart" | "sequenceDiagram" | "erDiagram" | "other";

const SEQ_KEYWORDS = new Set([
  "end", "actor", "participant", "loop", "alt", "else", "opt", "par", "and", "note", "rect",
  "critical", "break", "box", "activate", "deactivate", "autonumber", "title", "create", "destroy",
]);
const SEQ_OPEN = new Set(["alt", "loop", "opt", "par", "critical", "rect", "break", "box"]);

/** Index of the first body line after a leading `---` frontmatter block. */
function bodyStart(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") return i + 1;
  return 0;
}

function detectKind(code: string): Kind {
  const lines = code.split("\n");
  for (let i = bodyStart(lines); i < lines.length; i++) {
    const s = lines[i].trim();
    if (!s || s.startsWith("%%")) continue;
    const word = s.split(/[\s;]/)[0];
    if (word === "graph" || word === "flowchart" || word.startsWith("flowchart-")) return "flowchart";
    if (word === "sequenceDiagram" || word === "erDiagram") return word;
    return "other";
  }
  return "other";
}

/** Apply `fn` to body lines only (frontmatter and `%%` comment lines are skipped). */
function mapBody(code: string, fn: (line: string) => string): string {
  const lines = code.split("\n");
  const start = bodyStart(lines);
  for (let i = start; i < lines.length; i++) {
    if (lines[i].trim().startsWith("%%")) continue;
    lines[i] = fn(lines[i]);
  }
  return lines.join("\n");
}

const QUOTED = /"[^"\n]*"/g;

/** Same-length copy of `line` with the content of every `"…"` span blanked. */
function maskQuoted(line: string): string {
  return line.replace(QUOTED, (m) => `"${"\u0000".repeat(m.length - 2)}"`);
}

/**
 * Run a global regex (compiled with the `d` flag) against the quote-masked
 * line and splice replacements into the original, so nothing inside an
 * existing quoted label is matched. Masking preserves length, so match
 * indices map 1:1 onto the original line.
 */
function replaceOutsideQuotes(line: string, re: RegExp, fn: (groups: string[]) => string): string {
  const masked = maskQuoted(line);
  let out = "";
  let last = 0;
  re.lastIndex = 0;
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    const groups = (m.indices ?? []).map((span) => (span ? line.slice(span[0], span[1]) : ""));
    out += line.slice(last, m.index) + fn(groups);
    last = m.index + m[0].length;
  }
  return out + line.slice(last);
}

// ── R1 header ────────────────────────────────────────────────────────────────
function r1Header(code: string): string {
  const stripped = code.replace(/[\u200b-\u200d\u2060\ufeff]/g, "");
  const lines = stripped.split("\n");
  if (lines.length > 1 && lines[0].trim() === "mermaid") lines.shift();
  return lines.join("\n");
}

// ── R2 sequence keyword aliases ──────────────────────────────────────────────
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function r2SeqAlias(code: string): string {
  const bad = new Set<string>();
  for (const m of code.matchAll(/^[ \t]*(?:participant|actor)[ \t]+(\w+)/gm)) {
    if (SEQ_KEYWORDS.has(m[1].toLowerCase())) bad.add(m[1]);
  }
  if (bad.size === 0) return code;
  const taken = new Set(code.match(/\w+/g) ?? []);
  let lines = code.split("\n");
  for (const alias of [...bad].sort()) {
    let name = `p_${alias}`;
    for (let n = 2; taken.has(name); n++) name = `p_${alias}_${n}`;
    taken.add(name);
    const use = new RegExp(`(?<![\\w.])${escapeRe(alias)}(?=[ \\t]*(?:as\\b|-|\\+|:|,|$))`, "g");
    const decl = new RegExp(`^([ \\t]*(?:participant|actor)[ \\t]+)${escapeRe(alias)}\\b`);
    lines = lines.map((line) => {
      // A line consisting solely of a keyword (e.g. the block terminator `end`) is syntax, not an alias.
      if (SEQ_KEYWORDS.has(line.trim().toLowerCase())) return line;
      return line.replace(decl, `$1${name}`).replace(use, name);
    });
  }
  return lines.join("\n");
}

// ── R3 sequence block balance ────────────────────────────────────────────────
function r3SeqBlocks(code: string): string {
  const out: string[] = [];
  let depth = 0;
  for (const line of code.split("\n")) {
    const word = line.trim().split(/\s+/)[0];
    if (SEQ_OPEN.has(word)) depth++;
    else if (word === "end") {
      if (depth === 0) continue; // surplus end
      depth--;
    }
    out.push(line);
  }
  for (; depth > 0; depth--) out.push("end");
  return out.join("\n");
}

// ── R6 ER attribute types ────────────────────────────────────────────────────
function r6ErTypes(code: string): string {
  return code.replace(/^([ \t]+)(\S*[$<>(),.-]\S*)[ \t]+(\w+)/gm, (_m, ws: string, type: string, name: string) => {
    const t = (type.split("$").pop() ?? "").replace(/\W/g, "") || "Unknown";
    return `${ws}${t} ${name}`;
  });
}

// ── R4 edge labels ───────────────────────────────────────────────────────────
// A `|label|` directly attached to an edge operator (-->, ---, -.->, ==>, --x, --o …).
const EDGE_LABEL = /((?:--+|==+|-\.+-)[>xo]?)([ \t]*)\|([^|"\n]+)\|/dg;

function r4EdgeLabel(code: string): string {
  return mapBody(code, (line) =>
    replaceOutsideQuotes(line, EDGE_LABEL, ([whole, op, ws, label]) => {
      const text = label.trim();
      return text ? `${op}${ws}|"${text}"|` : whole;
    }),
  );
}

// ── R5 node labels ───────────────────────────────────────────────────────────
// Compound shapes first so their delimiters are never read as a single bracket.
// Single-char openers refuse a following shape char, so `A((x))` / `A([x])` /
// `C{{x}}` are never mistaken for a `(`/`[`/`{` label containing brackets.
const NODE_PAIRS: Array<[open: string, close: string, guard: string]> = [
  ["\\[\\[", "\\]\\]", '"'],
  ["\\[\\(", "\\)\\]", '"'],
  ["\\(\\[", "\\]\\)", '"'],
  ["\\(\\(", "\\)\\)", '"'],
  ["\\{\\{", "\\}\\}", '"'],
  ["\\[/", "/\\]", '"'],
  ["\\[\\\\", "\\\\\\]", '"'],
  ["\\[", "\\]", '"\\[\\(/\\\\'],
  ["\\{", "\\}", '"\\{'],
  ["\\(", "\\)", '"\\(\\['],
];
const SPECIAL = /[()[\]{}<>|;#]/;
// After the closing delimiter: whitespace, end of line, `:::class`, `;`, `&` or an edge operator.
const AFTER = "(?=[ \\t]|$|:::|;|&|--|==|-\\.|<-|<=|~~~)";
// Label length is bounded so a long unmatched line stays linear (perf budget).
const NODE_RES = NODE_PAIRS.map(
  ([o, c, guard]) => new RegExp(`(?<![\\w-])([\\w-]+)(${o})(?![${guard}])([^"\\n]{1,500}?)(${c})${AFTER}`, "dg"),
);
const SKIP_LINE = /^\s*(?:click|style|linkStyle|classDef|class)\b/;

function r5NodeLabel(code: string): string {
  return mapBody(code, (line) => {
    if (SKIP_LINE.test(line)) return line;
    let out = line;
    for (const re of NODE_RES) {
      out = replaceOutsideQuotes(out, re, ([whole, id, open, label, close]) =>
        SPECIAL.test(label) ? `${id}${open}"${label}"${close}` : whole,
      );
    }
    return out;
  });
}

// ── R7 chars inside quoted labels ────────────────────────────────────────────
function r7LabelChars(code: string): string {
  return mapBody(code, (line) => {
    if (SKIP_LINE.test(line)) return line;
    return line.replace(QUOTED, (q) =>
      // Keep mermaid entity escapes (`#quot;`, `#35;`) intact.
      q.replace(/(#\w+;)|[;#]/g, (m, entity: string | undefined) => entity ?? (m === ";" ? "," : "no.")),
    );
  });
}

// ── Driver ───────────────────────────────────────────────────────────────────
const RULES: Array<{ id: RuleId; kinds: Kind[] | null; fn: (code: string) => string }> = [
  { id: "R1", kinds: null, fn: r1Header },
  { id: "R2", kinds: ["sequenceDiagram"], fn: r2SeqAlias },
  { id: "R3", kinds: ["sequenceDiagram"], fn: r3SeqBlocks },
  { id: "R6", kinds: ["erDiagram"], fn: r6ErTypes },
  { id: "R4", kinds: ["flowchart"], fn: r4EdgeLabel },
  { id: "R5", kinds: ["flowchart"], fn: r5NodeLabel },
  { id: "R7", kinds: ["flowchart"], fn: r7LabelChars },
];
const MAX_PASSES = 5;

/**
 * Repair a (normalized) mermaid source. Applies R1, R2, R3, R6, R4, R5, R7 in
 * order, repeating the sequence until a fixpoint so the result is idempotent:
 * `repairMermaid(repairMermaid(x).code).applied` is always empty.
 */
export function repairMermaid(code: string): RepairResult {
  const applied = new Set<RuleId>();
  let current = code;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (const rule of RULES) {
      if (rule.kinds && !rule.kinds.includes(detectKind(current))) continue;
      const next = rule.fn(current);
      if (next !== current) {
        applied.add(rule.id);
        current = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { code: current, applied: RULES.map((r) => r.id).filter((id) => applied.has(id)) };
}

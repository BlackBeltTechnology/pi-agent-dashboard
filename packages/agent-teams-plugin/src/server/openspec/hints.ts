/**
 * `<!-- after: … -->` hints of a change's `tasks.md` (design D7, spec "Hint grammar" / "Hint leniency and
 * limits"). A SECOND pass over the raw file: the checkbox list itself (ids, lines, state) always comes from
 * `GET /api/openspec/tasks`, hints only add dependency edges. Hints are plain HTML comments, so the dashboard
 * parser and the OpenSpec CLI keep listing the same checkboxes; the plugin never rewrites them.
 *
 *  - Grammar: a comma-separated list of checkbox ids or `§<n>` section numbers; a bare number is a checkbox id
 *    first, then a section number. The keyword is case-insensitive and whitespace-tolerant; at most 64 entries.
 *  - Placement: trailing on a checkbox line, or on its own line DIRECTLY below a checkbox (applies to that box)
 *    or a `##` heading (applies to every box of the section; a box-level hint wins). Hints inside fenced code
 *    and on indented sub-bullets are ignored. The first hint of a box/section wins, a second is reported.
 *  - Every edge points BACKWARD in file order (a forward or self reference is dropped and reported), so a cycle
 *    among hints cannot form; no separate cycle pass exists.
 *  - Scanning is linear: one pass over the lines, `indexOf` only, no backtracking pattern over file text.
 * Boxes/headings are recognised exactly like the dashboard parser (`openspec-tasks.ts`: column-0 `- [ ]`/`- [x]`
 * and `## `), so line numbers join the `GET` answer.
 * See change: add-agent-teams-openspec.
 */

export const MAX_HINT_ENTRIES = 64;

// Mirrors `packages/server/src/openspec/openspec-tasks.ts` (CHECKBOX_RE / HEADING_RE).
const CHECKBOX_RE = /^(- \[)([ xX])(\] +)((?:[0-9]+(?:\.[0-9]+)* +)?)(.*)$/;
const HEADING_RE = /^##\s+(.*)$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const SECTION_REF_RE = /^§\s*(\d+)$/;

interface ScannedHint {
  /** Line (1-based) the comment sits on. */
  line: number;
  /** Trimmed non-empty entries, at most `MAX_HINT_ENTRIES`. */
  entries: string[];
  /** Entries beyond the cap (dropped). */
  overflow: number;
}

interface ScannedSection {
  /** Heading line (1-based). */
  line: number;
  /** The number `§n` addresses: the heading's leading integer, else its 1-based ordinal. */
  number: number;
}

export interface RawScan {
  /** `##` headings in file order. */
  sections: ScannedSection[];
  boxHints: Map<number, ScannedHint>;
  sectionHints: Map<number, ScannedHint>;
  /** Lines of ignored second hints (first one wins). */
  duplicateHintLines: number[];
}

/** A hint comment found in `s`: `[start, end)` covers `<!--` … `-->`; `body` is the text after the colon. */
interface HintComment {
  start: number;
  end: number;
  body: string;
}

const skipSpace = (s: string, from: number): number => {
  let i = from;
  while (i < s.length && /\s/.test(s[i] as string)) i++;
  return i;
};

/** Index of the `:` of an `<!-- after:` opener starting at `start` (keyword case-insensitive, whitespace-tolerant), else -1. */
function hintColonIndex(s: string, start: number): number {
  const i = skipSpace(s, start + 4);
  if (s.slice(i, i + 5).toLowerCase() !== "after") return -1;
  const j = skipSpace(s, i + 5);
  return s[j] === ":" ? j : -1;
}

/** Find the first `<!-- after: … -->` in `s`. Linear. */
function findHintComment(s: string): HintComment | undefined {
  let from = 0;
  for (;;) {
    const start = s.indexOf("<!--", from);
    if (start < 0) return undefined;
    const colon = hintColonIndex(s, start);
    if (colon >= 0) {
      // No closing marker after this start means none exists for any later start either.
      const close = s.indexOf("-->", colon + 1);
      return close < 0 ? undefined : { start, end: close + 3, body: s.slice(colon + 1, close) };
    }
    from = start + 4;
  }
}

/** Entries of a hint body (empty ones dropped), the first `MAX_HINT_ENTRIES` kept. */
function toHint(line: number, body: string): ScannedHint {
  const all = body.split(",").map((e) => e.trim()).filter((e) => e !== "");
  return { line, entries: all.slice(0, MAX_HINT_ENTRIES), overflow: Math.max(0, all.length - MAX_HINT_ENTRIES) };
}

/** The leading integer of a heading text, else `undefined`. */
const headingNumber = (text: string): number | undefined => {
  const m = /^\s*(\d{1,9})(?!\d)/.exec(text);
  return m ? Number(m[1]) : undefined;
};

/** Remove ONE trailing hint comment (and the whitespace before it) from a checkbox text. */
export function stripTrailingHint(text: string): string {
  const c = findHintComment(text);
  if (!c || text.slice(c.end).trim() !== "") return text;
  return text.slice(0, c.start).trimEnd();
}

interface Anchor {
  kind: "box" | "section";
  line: number;
}

/** Whether `line` opens/closes a fenced code block; updates the open-fence marker. */
function trackFence(line: string, state: { fence?: string | undefined }): boolean {
  const f = FENCE_RE.exec(line);
  if (!f) return false;
  const marker = f[1] as string;
  if (state.fence === undefined) state.fence = marker;
  else if (marker[0] === state.fence[0] && marker.length >= state.fence.length) state.fence = undefined;
  return true;
}

/** The trailing hint of a checkbox text (nothing may follow the comment), if any. */
function trailingHint(lineNo: number, text: string): ScannedHint | undefined {
  const c = findHintComment(text);
  return c && text.slice(c.end).trim() === "" ? toHint(lineNo, c.body) : undefined;
}

/** An own-line hint: the whole trimmed line is exactly one hint comment. */
function ownLineHint(lineNo: number, line: string): ScannedHint | undefined {
  const t = line.trim();
  const c = t.startsWith("<!--") ? findHintComment(t) : undefined;
  return c && c.start === 0 && c.end === t.length ? toHint(lineNo, c.body) : undefined;
}

/** Line-by-line state of the raw scan. */
class Scanner {
  readonly out: RawScan = { sections: [], boxHints: new Map(), sectionHints: new Map(), duplicateHintLines: [] };
  private fence: string | undefined;
  private anchor: Anchor | undefined;

  private record(a: Anchor, hint: ScannedHint): void {
    const map = a.kind === "box" ? this.out.boxHints : this.out.sectionHints;
    if (map.has(a.line)) this.out.duplicateHintLines.push(hint.line);
    else map.set(a.line, hint);
  }

  feed(line: string, lineNo: number): void {
    const state = { fence: this.fence };
    const isFence = trackFence(line, state);
    this.fence = state.fence;
    if (isFence) {
      this.anchor = undefined;
      return;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      this.out.sections.push({ line: lineNo, number: headingNumber(heading[1] as string) ?? this.out.sections.length + 1 });
      this.anchor = { kind: "section", line: lineNo };
      return;
    }
    const box = CHECKBOX_RE.exec(line);
    if (box) this.onBox(lineNo, box[5] as string);
    else this.onOther(line, lineNo);
  }

  private onBox(lineNo: number, text: string): void {
    this.anchor = { kind: "box", line: lineNo };
    const hint = this.fence === undefined ? trailingHint(lineNo, text) : undefined;
    if (hint) this.record(this.anchor, hint);
  }

  /** Directly below an anchor (consecutive hint lines keep it) an own-line comment is a hint; any other line ends the adjacency. */
  private onOther(line: string, lineNo: number): void {
    const hint = this.fence === undefined && this.anchor ? ownLineHint(lineNo, line) : undefined;
    if (hint && this.anchor) this.record(this.anchor, hint);
    else this.anchor = undefined;
  }
}

/** Scan the raw `tasks.md` text. */
export function scanHints(raw: string): RawScan {
  const scanner = new Scanner();
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    scanner.feed(line.endsWith("\r") ? line.slice(0, -1) : line, i + 1);
  }
  return scanner.out;
}

// ── resolution ────────────────────────────────────────────────────────────────

export interface HintBox {
  id: string;
  line: number;
  done: boolean;
}

type HintReportKind = "unknown" | "forward" | "self" | "duplicate" | "overflow" | "second_hint";

export interface HintReport {
  kind: HintReportKind;
  /** Line of the hint comment. */
  line: number;
  /** The offending entry (empty for `overflow`/`second_hint`). */
  entry: string;
  /** `overflow`: the number of dropped entries. */
  count?: number;
}

export interface ResolvedHints {
  /**
   * Explicit blockers (as checkbox lines) of every box a hint applies to (its own hint, else its section's).
   * An empty set means "no blockers". A box with no entry here keeps the default barrier.
   */
  blockers: Map<number, Set<number>>;
  reports: HintReport[];
}

/** Section index (into `scan.sections`, `-1` = before the first heading) of a line. */
export function sectionIndexOf(scan: RawScan, line: number): number {
  let idx = -1;
  for (let k = 0; k < scan.sections.length; k++) {
    if ((scan.sections[k] as ScannedSection).line < line) idx = k;
    else break;
  }
  return idx;
}

type Target = { kind: "box"; box: HintBox } | { kind: "section"; index: number };

/** Resolve one entry to a box or a section; `undefined` = unknown. */
function resolveEntry(entry: string, scan: RawScan, byId: ReadonlyMap<string, HintBox>): Target | undefined {
  const sec = SECTION_REF_RE.exec(entry);
  const sectionByNumber = (n: number): Target | undefined => {
    const index = scan.sections.findIndex((s) => s.number === n);
    return index >= 0 ? { kind: "section", index } : undefined;
  };
  if (sec) return sectionByNumber(Number(sec[1]));
  const box = byId.get(entry);
  if (box) return { kind: "box", box };
  return /^\d{1,9}$/.test(entry) ? sectionByNumber(Number(entry)) : undefined;
}

/**
 * Turn the scanned hints into blocker sets. `boxes` is the checkbox list of `GET /api/openspec/tasks` (ticked
 * ones included: a ticked target is satisfied and contributes no blocker). Entries are validated per hint:
 * unknown, duplicate, self and forward ones are dropped and reported.
 */
export function resolveHints(scan: RawScan, boxes: readonly HintBox[]): ResolvedHints {
  const reports: HintReport[] = [];
  const byId = new Map<string, HintBox>();
  const sectionOf = new Map<number, number>();
  const inSection = new Map<number, HintBox[]>();
  for (const b of boxes) {
    if (!byId.has(b.id)) byId.set(b.id, b);
    const s = sectionIndexOf(scan, b.line);
    sectionOf.set(b.line, s);
    inSection.set(s, [...(inSection.get(s) ?? []), b]);
  }
  for (const line of scan.duplicateHintLines) reports.push({ kind: "second_hint", line, entry: "" });

  /** `ok`, or why an entry cannot be an edge of this owner: it is the owner itself / its section, or comes later in the file. */
  const verdictOf = (target: Target, ownerSection: number, ownerBox: HintBox | undefined): "ok" | "self" | "forward" => {
    const targetSection = target.kind === "box" ? (sectionOf.get(target.box.line) as number) : target.index;
    if (target.kind === "box" && ownerBox) {
      if (target.box.line === ownerBox.line) return "self";
      return target.box.line > ownerBox.line ? "forward" : "ok";
    }
    if (targetSection === ownerSection) return "self";
    return targetSection > ownerSection ? "forward" : "ok";
  };

  /** Box lines an accepted target stands for: the box itself, or every box of the section; ticked ones are satisfied. */
  const linesOf = (target: Target): number[] => (target.kind === "box" ? [target.box] : (inSection.get(target.index) ?? [])).filter((b) => !b.done).map((b) => b.line);

  /** Judge one entry of a hint: why it is dropped, or the box lines it blocks on. `seen` collects the targets already used. */
  const judge = (entry: string, seen: Set<string>, ownerSection: number, ownerBox: HintBox | undefined): { problem: HintReportKind } | { lines: number[] } => {
    const target = resolveEntry(entry, scan, byId);
    if (!target) return { problem: "unknown" };
    const key = target.kind === "box" ? `b${target.box.line}` : `s${target.index}`;
    const dup = seen.has(key);
    seen.add(key);
    const verdict = verdictOf(target, ownerSection, ownerBox);
    if (dup) return { problem: "duplicate" };
    return verdict === "ok" ? { lines: linesOf(target) } : { problem: verdict };
  };

  /** Validate one hint of an owner (a box, or a whole section when `ownerBox` is undefined). */
  const resolveHint = (hint: ScannedHint, ownerSection: number, ownerBox: HintBox | undefined): Set<number> => {
    const out = new Set<number>();
    const seen = new Set<string>();
    if (hint.overflow > 0) reports.push({ kind: "overflow", line: hint.line, entry: "", count: hint.overflow });
    for (const entry of hint.entries) {
      const verdict = judge(entry, seen, ownerSection, ownerBox);
      if ("problem" in verdict) reports.push({ kind: verdict.problem, line: hint.line, entry });
      else for (const line of verdict.lines) out.add(line);
    }
    return out;
  };

  const blockers = new Map<number, Set<number>>();
  const sectionBlockers = new Map<number, Set<number>>();
  scan.sections.forEach((s, index) => {
    const hint = scan.sectionHints.get(s.line);
    if (hint) sectionBlockers.set(index, resolveHint(hint, index, undefined));
  });
  for (const b of boxes) {
    if (b.done) continue;
    const idx = sectionOf.get(b.line) as number;
    const own = scan.boxHints.get(b.line);
    if (own) blockers.set(b.line, resolveHint(own, idx, b));
    else if (sectionBlockers.has(idx)) blockers.set(b.line, new Set(sectionBlockers.get(idx)));
  }
  return { blockers, reports };
}

/** One-line, id-only description of a report (safe for a lead notice: no task text). */
export function describeHintReport(r: HintReport): string {
  const entry = r.entry.replace(/[^A-Za-z0-9.§_-]/g, "?").slice(0, 24);
  if (r.kind === "overflow") return `hint at line ${r.line}: ${r.count ?? 0} entries beyond ${MAX_HINT_ENTRIES} dropped`;
  if (r.kind === "second_hint") return `hint at line ${r.line}: a second hint on the same target was ignored`;
  return `hint at line ${r.line}: ${r.kind} entry ${entry} dropped`;
}

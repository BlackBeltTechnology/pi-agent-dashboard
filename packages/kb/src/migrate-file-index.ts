// One-time migration core: re-home docs/file-index-<area>.md purposes into a
// per-directory AGENTS.md tree, and mark files with no covering row as `miss`
// (authored from source by @fast subagents). PURE + testable; the actual
// subagent fan-out is driven by the orchestrating agent, which calls these
// helpers for parse / plan / tier-0 rows / validation / render.
import { basename, relative } from "node:path";

export interface IndexRow {
  purpose: string; // verbatim purpose column (incl. inline "See change:")
  seeChange: string[]; // extracted change ids
}

const ROW_RE = /^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|\s*$/;
const SEE_CHANGE_RE = /See change:\s*([A-Za-z0-9_-]+)/g;

/** Parse a single file-index split's markdown into path → {purpose, seeChange}. */
export function parseFileIndex(text: string): Map<string, IndexRow> {
  const out = new Map<string, IndexRow>();
  for (const line of text.split("\n")) {
    const m = line.match(ROW_RE);
    if (!m) continue;
    const path = m[1].trim();
    const purpose = m[2].trim();
    // skip the header separator / pointer rows that aren't source paths
    if (!purpose || path === "File") continue;
    const seeChange = [...purpose.matchAll(SEE_CHANGE_RE)].map((mm) => mm[1]);
    out.set(path, { purpose, seeChange });
  }
  return out;
}

/** Merge many split files (already read to text) into one index. */
export function mergeIndex(texts: string[]): Map<string, IndexRow> {
  const merged = new Map<string, IndexRow>();
  for (const t of texts) for (const [k, v] of parseFileIndex(t)) merged.set(k, v);
  return merged;
}

export type FileStatus = "hit" | "miss";
export interface FileEntry {
  rel: string; // repo-relative source path
  base: string; // basename (row key in its AGENTS.md)
  status: FileStatus;
  purpose?: string; // present for hits (verbatim from index)
}
export interface DirPlan {
  dir: string; // repo-relative directory
  tier: 0 | 1; // 0 = all hits (deterministic), 1 = ≥1 miss (needs subagent)
  files: FileEntry[];
}

/** Join enumerated source groups against the parsed index; classify tier. */
export function planDirs(groups: Map<string, string[]>, index: Map<string, IndexRow>): DirPlan[] {
  const plans: DirPlan[] = [];
  for (const [dir, rels] of groups) {
    const files: FileEntry[] = rels.map((rel) => {
      const row = index.get(rel);
      return row
        ? { rel, base: basename(rel), status: "hit" as const, purpose: row.purpose }
        : { rel, base: basename(rel), status: "miss" as const };
    });
    files.sort((a, b) => a.base.localeCompare(b.base));
    const tier = files.every((f) => f.status === "hit") ? 0 : 1;
    plans.push({ dir, tier, files });
  }
  plans.sort((a, b) => a.dir.localeCompare(b.dir));
  return plans;
}

const rowFor = (base: string, purpose: string) => `| \`${base}\` | ${purpose} |`;

const byBaseAlpha = (files: FileEntry[]) => [...files].sort((a, b) => a.base.localeCompare(b.base));

/** Deterministic Tier-0 rows: verbatim index purposes, path-alphabetical. */
export function tier0Rows(plan: DirPlan): string[] {
  return byBaseAlpha(plan.files).map((f) => rowFor(f.base, f.purpose ?? ""));
}

/** Render a directory AGENTS.md body from its rows. */
export function renderAgentsMd(dir: string, rows: string[]): string {
  return `# DOX — ${dir}\n\nFiles in this directory. One row per source file.\n\n| File | Purpose |\n|------|---------|\n${rows.join("\n")}\n`;
}

export interface AuthoredRow {
  base: string;
  purpose: string;
}
export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Structural gate (design §4c): exactly one non-empty row per input file;
 *  hit purposes byte-identical to the index. Semantic review is separate. */
export function validateAuthored(plan: DirPlan, authored: AuthoredRow[]): ValidationResult {
  const errors: string[] = [];
  const byBase = new Map<string, string>();
  for (const a of authored) {
    if (byBase.has(a.base)) errors.push(`duplicate row for ${a.base}`);
    byBase.set(a.base, a.purpose);
  }
  for (const f of plan.files) {
    const p = byBase.get(f.base);
    if (p === undefined) {
      errors.push(`missing row for ${f.base}`);
      continue;
    }
    if (!p.trim()) errors.push(`empty purpose for ${f.base}`);
    if (f.status === "hit" && p !== f.purpose) errors.push(`hit purpose drifted for ${f.base}`);
  }
  for (const base of byBase.keys()) {
    if (!plan.files.some((f) => f.base === base)) errors.push(`unexpected row for ${base}`);
  }
  return { ok: errors.length === 0, errors };
}

/** Build final rows for a plan given authored purposes (used after validation). */
export function finalRows(plan: DirPlan, authored: AuthoredRow[]): string[] {
  const byBase = new Map(authored.map((a) => [a.base, a.purpose]));
  return byBaseAlpha(plan.files).map((f) => rowFor(f.base, byBase.get(f.base) ?? f.purpose ?? ""));
}

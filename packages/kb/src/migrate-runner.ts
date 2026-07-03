// One-off big-bang runner for the file-index → AGENTS.md tree migration.
// Deterministic + resumable. The orchestrating agent drives Tier-1 authoring by
// spawning @fast subagents; this module owns everything else: plan, batch,
// grounding gate, idempotent per-dir write, checkpoint/gaps persistence.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { areaFiles } from "./dox.js";
import { type AuthoredRow, type DirPlan, finalRows, mergeIndex, planDirs, renderAgentsMd, validateAuthored } from "./migrate-file-index.js";

export const PACKAGES_ROOT_RE = /^packages\//;

/** Read every docs/file-index-*.md split as raw text. */
export function loadSplitTexts(cwd: string): string[] {
  const docs = join(cwd, "docs");
  return readdirSync(docs)
    .filter((f) => /^file-index-.*\.md$/.test(f))
    .map((f) => readFileSync(join(docs, f), "utf8"));
}

/** Build all dir plans for the migration scope (packages/ source tree). */
export function buildDirPlans(cwd: string): DirPlan[] {
  const index = mergeIndex(loadSplitTexts(cwd));
  const groups = new Map([...areaFiles(cwd)].filter(([dir]) => PACKAGES_ROOT_RE.test(dir)));
  return planDirs(groups, index);
}

// --- grounding gate (deterministic semantic check) ---
// Every backticked identifier in an authored purpose must appear in the source
// file. Catches hallucinated exports/symbols — the dominant Tier-1 failure mode.
const STOP = new Set(["React", "DOM", "JSON", "HTML", "URL", "API", "HTTP", "CSS", "UI", "TODO"]);
function significantIds(span: string): string[] {
  const ids = span.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
  // only mixed-case (camel/Pascal) or underscore identifiers — the export-name shapes
  return ids.filter((id) => id.length >= 3 && !STOP.has(id) && (/[a-z]/.test(id) && /[A-Z]/.test(id) || id.includes("_")));
}
export function groundingCheck(purpose: string, sourceText: string, known?: Set<string>): { ok: boolean; ungrounded: string[] } {
  const spans = [...purpose.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const ungrounded: string[] = [];
  for (const span of spans) {
    for (const id of significantIds(span)) {
      // grounded if the identifier appears in this file OR is another source
      // file's stem (a legitimate cross-reference to a consumer/related module).
      if (known?.has(id)) continue;
      if (!new RegExp(`\\b${id.replace(/\$/g, "\\$")}\\b`).test(sourceText)) ungrounded.push(id);
    }
  }
  return { ok: ungrounded.length === 0, ungrounded: [...new Set(ungrounded)] };
}

/** All source-file stems (basename without extension) across the plans — the
 *  cross-reference allowlist for grounding. */
export function knownStems(plans: DirPlan[]): Set<string> {
  const s = new Set<string>();
  for (const p of plans) for (const f of p.files) s.add(f.base.replace(/\.[^.]+$/, ""));
  return s;
}

// --- batching (design §4b) ---
export interface MissRef {
  dir: string;
  base: string;
  rel: string;
}
export interface Batch {
  dirs: string[];
  miss: MissRef[];
}
/** Group tier-1 miss files into batches: ≤maxMiss files and ≤maxDirs dirs per
 *  batch; a dir with >maxMiss misses splits into sequential same-dir batches. */
export function makeBatches(plans: DirPlan[], opts: { maxMiss?: number; maxDirs?: number } = {}): Batch[] {
  const maxMiss = opts.maxMiss ?? 20;
  const maxDirs = opts.maxDirs ?? 8;
  const batches: Batch[] = [];
  let cur: Batch = { dirs: [], miss: [] };
  const flush = () => {
    if (cur.miss.length) batches.push(cur);
    cur = { dirs: [], miss: [] };
  };
  for (const plan of plans.filter((p) => p.tier === 1)) {
    const misses = plan.files.filter((f) => f.status === "miss").map((f) => ({ dir: plan.dir, base: f.base, rel: f.rel }));
    if (misses.length > maxMiss) {
      flush();
      for (let i = 0; i < misses.length; i += maxMiss) batches.push({ dirs: [plan.dir], miss: misses.slice(i, i + maxMiss) });
      continue;
    }
    if (cur.miss.length + misses.length > maxMiss || cur.dirs.length + 1 > maxDirs) flush();
    cur.dirs.push(plan.dir);
    cur.miss.push(...misses);
  }
  flush();
  return batches;
}

/** The exact @fast subagent prompt for one batch (read-only authoring). */
export function subagentPrompt(cwd: string, batch: Batch): string {
  const lines = batch.miss.map((m) => `- ${m.rel}`).join("\n");
  return `You author one-line "purpose" table rows for a per-directory AGENTS.md file index. READ-ONLY: you may Read source files; you MUST NOT write or edit anything. Output ONLY the table rows, one per file, nothing else.

Repo root: ${cwd}
Author a row for EACH of these ${batch.miss.length} files (Read each fully first):
${lines}

Row schema (path column = the EXACT repo-relative path from the list above, one line per file):
| \`<repo-relative-path>\` | <purpose> |

CAVEMAN STYLE for the purpose column (mandatory):
- Short declarative fragments. Drop articles (a/an/the) and copulas when meaning survives.
- Subject → verb → object, present tense. No hedging, no "we"/"you", no marketing.
- One fact per clause. Prefer concrete tokens (exported symbols, types, function names, paths) over prose.
- Keep identifiers verbatim inside backticks. Name the key exports + the file's role.
- Do NOT invent a "See change:" annotation. Only real source facts.

Output exactly ${batch.miss.length} lines (the rows), each starting with the file's repo-relative path in backticks, nothing before or after.`;
}

/** Parse a subagent batch reply into rel-path → purpose. */
export function parseAuthoredBatch(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    // tolerate LLM output that drops the trailing pipe: `| path | purpose` or `| path | purpose |`
    const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*$/);
    if (!m) continue;
    const purpose = m[2].replace(/\s*\|\s*$/, "").trim();
    if (purpose) out.set(m[1].trim(), purpose);
  }
  return out;
}

/** Fold a parsed batch reply into migration state (state.authored[dir][base]). */
export function recordAuthored(state: MigrationState, batch: Batch, byRel: Map<string, string>): { recorded: number; missing: string[] } {
  let recorded = 0;
  const missing: string[] = [];
  for (const m of batch.miss) {
    const purpose = byRel.get(m.rel);
    if (!purpose) {
      missing.push(m.rel);
      continue;
    }
    (state.authored[m.dir] ??= {})[m.base] = purpose;
    recorded++;
  }
  return { recorded, missing };
}

// --- per-dir assembly + idempotent write ---
/** Assemble one dir's AGENTS.md from its plan + authored miss rows, validate,
 *  ground-check, and write. Returns {ok, errors, ungrounded}. Idempotent. */
export function writeDir(cwd: string, plan: DirPlan, authoredMiss: Map<string, string>, opts: { dryRun?: boolean; known?: Set<string> } = {}): {
  ok: boolean;
  errors: string[];
  ungrounded: { base: string; ids: string[] }[];
} {
  const authored: AuthoredRow[] = plan.files.map((f) =>
    f.status === "hit" ? { base: f.base, purpose: f.purpose! } : { base: f.base, purpose: authoredMiss.get(f.base) ?? "" },
  );
  const v = validateAuthored(plan, authored);
  const ungrounded: { base: string; ids: string[] }[] = [];
  for (const f of plan.files) {
    if (f.status !== "miss") continue;
    const purpose = authoredMiss.get(f.base) ?? "";
    const src = readFileSync(join(cwd, f.rel), "utf8");
    const g = groundingCheck(purpose, src, opts.known);
    if (!g.ok) ungrounded.push({ base: f.base, ids: g.ungrounded });
  }
  if (!v.ok) return { ok: false, errors: v.errors, ungrounded };
  if (!opts.dryRun) {
    const md = renderAgentsMd(plan.dir, finalRows(plan, authored));
    const file = join(cwd, plan.dir, "AGENTS.md");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, md, "utf8");
  }
  return { ok: v.ok, errors: v.errors, ungrounded };
}

// --- checkpoint / gaps persistence (resumability) ---
const stateDir = (cwd: string) => join(cwd, ".pi", "dashboard", "kb");
export interface MigrationState {
  authored: Record<string, Record<string, string>>; // dir → base → purpose
  doneDirs: string[];
  gaps: Record<string, string[]>; // dir → messages
}
export function loadState(cwd: string): MigrationState {
  const f = join(stateDir(cwd), "migration-state.json");
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  return { authored: {}, doneDirs: [], gaps: {} };
}
export function saveState(cwd: string, s: MigrationState): void {
  const dir = stateDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "migration-state.json"), JSON.stringify(s, null, 2), "utf8");
}

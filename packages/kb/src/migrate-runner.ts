// One-off big-bang runner for the file-index → AGENTS.md tree migration.
// Deterministic + resumable. The orchestrating agent drives Tier-1 authoring by
// spawning @fast subagents; this module owns everything else: plan, batch,
// grounding gate, idempotent per-dir write, checkpoint/gaps persistence.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { areaFiles } from "./dox.js";
import { type DirPlan, type AuthoredRow, finalRows, mergeIndex, planDirs, renderAgentsMd, tier0Rows, validateAuthored } from "./migrate-file-index.js";

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

// --- rollup export (task 4.3, design §4d option B) ---
// Regenerate the packages-covering docs/file-index-<area>.md splits from the
// tree. SAFETY: preserve every existing row (tree holds only SOURCE files;
// splits also carry package.json/.json/skill-dir rows that MUST survive);
// overlay source-file rows from the tree (hits byte-identical, misses added);
// inherit each new row's owning split from where its sibling files already live.
const SPLIT_AREAS = ["shared", "extension", "server", "client", "electron", "plugins", "kb", "document-converter", "skills-misc"];

interface SplitDoc {
  area: string;
  file: string;
  header: string[]; // lines up to and including the |---|---| separator
  rows: Map<string, string>; // path → purpose (insertion order irrelevant; re-sorted on write)
}

function parseSplit(file: string): SplitDoc | null {
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, "utf8").split("\n");
  const sep = lines.findIndex((l) => /^\|\s*-+\s*\|\s*-+\s*\|/.test(l));
  const header = sep >= 0 ? lines.slice(0, sep + 1) : lines;
  const rows = new Map<string, string>();
  for (const l of lines.slice(sep + 1)) {
    const m = l.match(/^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|\s*$/);
    if (m) rows.set(m[1].trim(), m[2].trim());
  }
  const area = basename(file).replace(/^file-index-/, "").replace(/\.md$/, "");
  return { area, file, header, rows };
}

/** Reconstruct full repo-relative source rows from the tree (dir + basename). */
export function treeRows(cwd: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      if (e.name === "node_modules" || e.name === "dist") continue;
      if (e.isDirectory()) walk(abs);
      else if (e.name === "AGENTS.md") {
        const relDir = relative(cwd, dir);
        for (const l of readFileSync(abs, "utf8").split("\n")) {
          const m = l.match(/^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|\s*$/);
          if (m && m[1] !== "File") out.set(join(relDir, m[1].trim()), m[2].trim());
        }
      }
    }
  };
  walk(join(cwd, "packages"));
  return out;
}

export interface RollupResult {
  perArea: Record<string, { added: number; changed: number; total: number }>;
  unassigned: string[];
}
/** Merge tree source rows into the packages-covering splits. Idempotent. */
export function exportRollup(cwd: string, opts: { write?: boolean } = {}): RollupResult {
  const docs = join(cwd, "docs");
  const splits = SPLIT_AREAS.map((a) => parseSplit(join(docs, `file-index-${a}.md`))).filter((s): s is SplitDoc => !!s);
  // ownership: existing path → area; dir → area vote
  const pathOwner = new Map<string, string>();
  const dirVotes = new Map<string, Map<string, number>>();
  for (const s of splits)
    for (const p of s.rows.keys()) {
      pathOwner.set(p, s.area);
      const d = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".";
      const v = dirVotes.get(d) ?? new Map();
      v.set(s.area, (v.get(s.area) ?? 0) + 1);
      dirVotes.set(d, v);
    }
  const majority = (d: string): string | null => {
    const v = dirVotes.get(d);
    if (!v) return null;
    return [...v.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  // package-root vote: split owning the most existing paths under packages/<pkg>/
  const packageRootOwner = (p: string): string | null => {
    const parts = p.split("/");
    if (parts[0] !== "packages" || parts.length < 2) return null;
    const prefix = `packages/${parts[1]}/`;
    const votes = new Map<string, number>();
    for (const [ep, area] of pathOwner) if (ep.startsWith(prefix)) votes.set(area, (votes.get(area) ?? 0) + 1);
    if (!votes.size) return null;
    return [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  const ownerOf = (p: string): string | null => {
    if (pathOwner.has(p)) return pathOwner.get(p)!;
    let d = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".";
    while (d && d !== ".") {
      const m = majority(d);
      if (m) return m;
      d = d.includes("/") ? d.slice(0, d.lastIndexOf("/")) : ".";
    }
    return packageRootOwner(p);
  };
  const byArea = new Map(splits.map((s) => [s.area, s]));
  const result: RollupResult = { perArea: {}, unassigned: [] };
  const adds = new Map<string, Map<string, string>>(); // area → path → purpose
  for (const [p, purpose] of treeRows(cwd)) {
    const area = ownerOf(p);
    if (!area || !byArea.has(area)) {
      result.unassigned.push(p);
      continue;
    }
    (adds.get(area) ?? adds.set(area, new Map()).get(area)!).set(p, purpose);
  }
  for (const s of splits) {
    const treeForArea = adds.get(s.area) ?? new Map();
    let added = 0;
    let changed = 0; // divergent existing rows: KEPT (never overwritten), counted only
    const merged = new Map(s.rows);
    for (const [p, purpose] of treeForArea) {
      if (!merged.has(p)) {
        merged.set(p, purpose); // add-only: new source rows
        added++;
      } else if (merged.get(p) !== purpose) {
        changed++; // existing curated row differs (cross-split dup) — keep existing, do NOT overwrite
      }
    }
    result.perArea[s.area] = { added, changed, total: merged.size };
    if (opts.write) {
      const sorted = [...merged.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const banner = "> **Source-file rows synced from the per-directory `AGENTS.md` tree** (change: migrate-file-index-to-agents-tree). Edit `packages/**` source rows in the directory `AGENTS.md`, not here; non-source rows (package.json, *.json, skill dirs) stay hand-maintained.";
      const head = [...s.header];
      if (!head.some((l) => l.includes("Source-file rows synced"))) {
        const sepIdx = head.findIndex((l) => /^\|\s*-+\s*\|/.test(l));
        head.splice(sepIdx - 1, 0, banner, ""); // insert banner just before the table header row
      }
      const body = sorted.map(([p, purpose]) => `| \`${p}\` | ${purpose} |`);
      writeFileSync(s.file, head.join("\n") + "\n" + body.join("\n") + "\n", "utf8");
    }
  }
  return result;
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

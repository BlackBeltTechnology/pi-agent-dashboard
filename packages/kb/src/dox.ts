// DOX tree: directory-level AGENTS.md scaffolding + audit, and the
// `kb agents <path>` nearest-applicable chain (design §6d). Pure-local,
// deterministic, no LLM/embedding. The detect-don't-write rule: `dox init`
// and `--fix` only fill PATH columns / prune orphans; the LLM authors purposes.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { type GitignoreMatcher, loadGitignoreMatcher } from "./gitignore.js";
import { readStaleness } from "./staleness.js";
import type { KbStore } from "./types.js";

// delta ②: exclude worktree checkouts, archived openspec proposals, and doc-example noise.
// Also exclude build output (`out`) and the electron bundled/vendored trees
// (`bundled-extensions`, `electron/resources/server`) — all gitignored, zero
// tracked md; the walk is fs-based so they surface as bogus missing/companion
// rows without this. `server` is scoped to `electron/resources/server` so real
// `server` source dirs (packages/server, kb-plugin/src/server) stay indexed.
// Also skip scratch/output + narrative dirs (`mockups`, `research`, `site`,
// `.github`, `Prompt stories` — session-to-guideline playbooks: prose, not
// navigable source) and self-evident top-level docs (`CHANGELOG.md`, `CLAUDE.md`,
// repo-root `README.md`) with no per-file DOX value; `README` anchored to root so
// package READMEs stay documented.
// `.pi` is NOT excluded wholesale: `.pi/skills/`, `.pi/agents/` and `.pi/prompts/`
// carry per-file DOX rows per the Documentation Update Protocol, and excluding the
// whole tree blinded the orphan check there. Only the non-source `.pi` subdirs
// (caches, kb index, npm/git mirrors, flow run state) are skipped.
const DEFAULT_EXCLUDE = /(^|\/)(node_modules|\.git|\.github|dist|build|out|\.next|coverage|\.kb|\.worktrees|\.reverse-spec-scratch|openspec|doc-example|bundled-extensions|mockups|research|site|Prompt stories)(\/|$)|(^|\/)\.pi\/(dashboard|npm|git|flows)(\/|$)|(^|\/)electron\/resources\/server(\/|$)|(^|\/)(CHANGELOG|CLAUDE)\.md$|^README\.md$/;
/**
 * `AGENTS.override.md` (pi 0.84.0) REPLACES a directory's context rather than
 * adding to it, so it is listed first and shadows the other candidates in the
 * SAME directory. Mirrors pi's own first-match-wins candidate list in
 * `dist/core/resource-loader.js`. Ancestor inheritance is unaffected.
 * See change: update-pi-core-0-84-adopt-apis.
 */
const AGENTS_OVERRIDE_FILE = "AGENTS.override.md";
const AGENTS_FILES = [AGENTS_OVERRIDE_FILE, "AGENTS.md"];
// delta ①: dox init now maps SOURCE, not docs. Source globs, minus type decls and tests.
const SOURCE_EXT = /\.(ts|tsx|js|jsx)$/;
const MD_EXT = /\.(md|mdx)$/i;
function isSourceFile(name: string): boolean {
  return SOURCE_EXT.test(name) && !/\.d\.ts$/.test(name) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(name);
}
function isMdFile(name: string): boolean {
  // `*.AGENTS.md` sidecars (per-file index promotions) and `*.agent.md`
  // companions (pull-only index of a large doc) are DOX index artifacts, not
  // documentable source — exclude from the md walk so they need no row/companion
  // of their own (else a companion needs a companion-of-a-companion, ad infinitum).
  return (
    MD_EXT.test(name) &&
    !AGENTS_FILES.includes(name) &&
    !name.endsWith(".AGENTS.md") &&
    !name.endsWith(".agent.md")
  );
}
const AREA_FILE_THRESHOLD = 8; // ≥ this many md files in a subdir → own AGENTS.md
const ROW_CAP = 40;
// pi auto-injects a dir AGENTS.md on every turn when cwd sits at/below it. Past
// this byte cap it is "too large" → split file-based: promote the heaviest rows
// to `<File>.AGENTS.md` sidecars (pull-only) + cap remaining rows to one line.
export const AGENTS_BYTE_CAP = 30000;
const COMPANION_LOC = 300;
const COMPANION_BYTES = 15000;

export interface AgentsChainOpts {
  claudeMd?: boolean;
  fallbackManifest?: boolean;
}
export interface AgentsEntry {
  path: string; // absolute AGENTS.md path
  rel: string; // relative to cwd
  depth: number; // 0 = root
}

/** Walk from cwd down to targetPath's dir, collecting AGENTS.md (CLAUDE.md if
 *  claudeMd) on the ancestor chain. Returns root→nearest order. */
export function agentsChain(cwd: string, targetPath: string, opts: AgentsChainOpts = {}): { chain: AgentsEntry[]; manifest: string | null } {
  const names = opts.claudeMd ? [...AGENTS_FILES, "CLAUDE.md"] : AGENTS_FILES;
  const target = isAbsolute(targetPath) ? targetPath : resolve(cwd, targetPath);
  // collect ancestor dirs from target up to cwd. Use a path-boundary check
  // (sep-aware) so a sibling like `/foo-bar` is not treated as inside `/foo`.
  const withinCwd = (p: string) => p === cwd || p.startsWith(cwd + sep);
  const dirs: string[] = [];
  const d = existsSync(target) && statSync(target).isDirectory() ? target : dirname(target);
  for (let cur = d; withinCwd(cur); cur = dirname(cur)) {
    dirs.push(cur);
    if (cur === cwd) break;
  }
  if (!dirs.includes(cwd)) dirs.push(cwd);
  // root→nearest = cwd first → target
  const ordered = dirs.reverse();
  const chain: AgentsEntry[] = [];
  ordered.forEach((dir, depth) => {
    // An override replaces this directory's context: take it alone and skip the
    // siblings, otherwise the same logical scope is injected twice.
    const override = join(dir, AGENTS_OVERRIDE_FILE);
    if (existsSync(override)) {
      chain.push({ path: override, rel: relative(cwd, override) || AGENTS_OVERRIDE_FILE, depth });
      return;
    }
    for (const name of names) {
      if (name === AGENTS_OVERRIDE_FILE) continue;
      const p = join(dir, name);
      if (existsSync(p)) chain.push({ path: p, rel: relative(cwd, p) || name, depth });
    }
  });
  let manifest: string | null = null;
  if (chain.length === 0 && opts.fallbackManifest) {
    manifest = fallbackManifest(cwd, target);
  }
  return { chain, manifest };
}

/** KB-generated routing manifest when no AGENTS.md exists on the path: lists
 *  markdown files under the target subtree as a path → heading map. */
export function fallbackManifest(cwd: string, targetPath: string, store?: KbStore): string {
  const target = isAbsolute(targetPath) ? targetPath : resolve(cwd, targetPath);
  const walkRoot = existsSync(target) && statSync(target).isDirectory() ? target : dirname(target);
  const files = walkMd(walkRoot);
  const lines = [`# KB routing manifest for ${relative(cwd, target) || target}`, "", "No AGENTS.md on this path. Generated map of nearby markdown:", ""];
  for (const f of files.slice(0, 50)) {
    const rel = relative(cwd, f) || basename(f);
    lines.push(`- \`${rel}\``);
  }
  if (store) {
    lines.push("", "## Top sections in this subtree");
    const hits = store.search(relative(cwd, target) || basename(target), { limit: 10 });
    for (const h of hits) lines.push(`- \`${h.path}\` :: ${h.headingPath}`);
  }
  return lines.join("\n");
}

// --- row recognition (design D1/D2, fix-dox-lint-blind-rows) ---

// A row counts iff it sits in a table whose header matches EXACTLY this shape
// (whitespace-flexible, exact cell names, case-sensitive — all walked tables
// match exactly). Recognition is keyed on the TABLE, never on heading state:
// a heading-state gate silently skips rows under subheadings and in files
// without a `# DOX` heading, while reporting the file as clean.
const FILE_TABLE_HEADER = /^\|\s*File\s*\|\s*Purpose\s*\|\s*$/;
// A delimiter row: pipes + dash cells only. The FIRST delimiter after the
// header belongs to the table; a SECOND one closes it — a directly-adjacent
// prose table brings its own delimiter, which ends the file table before the
// prose body cells can be read as rows (the adjacency hazard).
const TABLE_DELIMITER = /^\|(?:\s*:?-+:?\s*\|)+$/;
const ROW_PATH = /^\|\s*`([^`]+)`\s*\|/;

export interface DoxRow {
  path: string; // the backticked row path (relative to its AGENTS.md dir)
  line: string; // the raw line
  lineIndex: number; // index into text.split("\n") — the --fix prune key
}
export interface DoxScan {
  rows: DoxRow[];
  /** File-row tables from which zero rows were recognized (header line
   *  indexes). A header nobody filled is a finding, not silence. */
  emptyFileTables: { line: number }[];
}

/** Recognize DOX file rows by table header (design D1). One state machine,
 *  three consumers (parseRowPaths, countInlineRows, doxLint). Opens on the
 *  header line; stays open while lines start with `|` and are not a second
 *  delimiter; closes on the first non-`|` line or the second delimiter. */
export function scanDoxRows(text: string): DoxScan {
  const rows: DoxRow[] = [];
  const emptyFileTables: { line: number }[] = [];
  const lines = text.split("\n");
  let open = false;
  let seenDelimiter = false;
  let rowsInTable = 0;
  let headerLine = -1;
  const closeTable = () => {
    if (open && rowsInTable === 0) emptyFileTables.push({ line: headerLine });
    open = false;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FILE_TABLE_HEADER.test(line)) {
      closeTable();
      open = true;
      seenDelimiter = false;
      rowsInTable = 0;
      headerLine = i;
      continue;
    }
    if (!open) continue;
    if (!line.startsWith("|") || !line.slice(1).includes("|")) {
      closeTable();
      continue;
    }
    if (TABLE_DELIMITER.test(line)) {
      if (seenDelimiter) closeTable();
      else seenDelimiter = true;
      continue;
    }
    const m = line.match(ROW_PATH);
    if (m) {
      rows.push({ path: m[1], line, lineIndex: i });
      rowsInTable++;
    }
  }
  closeTable();
  return { rows, emptyFileTables };
}

const FILE_TABLE_TEMPLATE = "| File | Purpose |\n|---|---|\n";

/** Table-aware row insertion (design D2). Appends after the file table's last
 *  row (never a leading blank line — that would close the table); creates the
 *  header + delimiter at EOF when the file has no file table. Shared by
 *  --fix's missing arm AND doxInit, so appended rows are recognized on the
 *  next run and duplicates never accumulate. */
function insertRows(text: string, newRows: string[]): string {
  const scan = scanDoxRows(text);
  const lines = text.split("\n");
  if (scan.rows.length > 0) {
    const at = scan.rows[scan.rows.length - 1].lineIndex + 1;
    lines.splice(at, 0, ...newRows);
    return lines.join("\n");
  }
  if (scan.emptyFileTables.length > 0) {
    const h = scan.emptyFileTables[scan.emptyFileTables.length - 1].line;
    const at = h + 1 < lines.length && TABLE_DELIMITER.test(lines[h + 1]) ? h + 2 : h + 1;
    lines.splice(at, 0, ...newRows);
    return lines.join("\n");
  }
  const prefix = text === "" ? "" : text.endsWith("\n") ? text : `${text}\n`;
  return `${prefix}\n${FILE_TABLE_TEMPLATE}${newRows.join("\n")}\n`;
}

function appendRowsToAgentsFile(agentsFile: string, rows: string[]): void {
  if (rows.length === 0) return;
  let text = "";
  try {
    text = readFileSync(agentsFile, "utf8");
  } catch {
    /* new file — insertRows creates the table from scratch */
  }
  writeFileSync(agentsFile, insertRows(text, rows), "utf8");
}

// --- dox init ---

export interface DoxInitOptions {
  dryRun?: boolean;
  cwd: string;
}
export interface DoxInitPlan {
  created: string[]; // AGENTS.md paths to create
  appended: { file: string; rows: string[] }[]; // existing files getting new rows
}

// delta ①: parameterized walker. `dox init` walks source (walkSource); fallbackManifest
// + doxLint keep walking md (walkMd). __tests__ dirs are always skipped.
// DEFAULT_EXCLUDE is tested against the path RELATIVE to the walk root, so an
// ancestor dir named like an excluded token (e.g. running inside .worktrees)
// does not nuke the whole walk.
function walkFiles(dir: string, match: (name: string) => boolean, out: string[] = [], root: string = dir, ignore?: GitignoreMatcher): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (DEFAULT_EXCLUDE.test(relative(root, abs))) continue;
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      const rel = relative(root, abs);
      // Conservative dir-pruning (design D3): hard-prune only when the dir
      // matches AND no deeper .gitignore could negate it; otherwise descend
      // and filter files at match time so deep negations survive.
      if (ignore?.isIgnoredDir(rel) && !ignore.hasDeeperGitignore(rel)) continue;
      walkFiles(abs, match, out, root, ignore);
    } else if (match(e.name) && !ignore?.isIgnored(relative(root, abs))) out.push(abs);
  }
  return out;
}
function walkMd(dir: string, out: string[] = [], ignore?: GitignoreMatcher): string[] {
  return walkFiles(dir, isMdFile, out, dir, ignore);
}
function walkSource(dir: string, out: string[] = [], ignore?: GitignoreMatcher): string[] {
  return walkFiles(dir, isSourceFile, out, dir, ignore);
}

/** Resolve a DOX row path. Rows document paths RELATIVE TO THEIR OWN AGENTS.md
 *  dir. A directory may also document a file that lives OUTSIDE its own dir (a
 *  nested AGENTS.md referencing a project-root file) — so fall back to `cwd`
 *  when the dir-relative target is absent. Returns the dir-relative candidate
 *  when neither exists (caller flags orphan). */
export function resolveRowPath(agentsDir: string, cwd: string, rp: string): string {
  if (isAbsolute(rp)) return rp;
  const dirRel = resolve(agentsDir, rp);
  if (existsSync(dirRel)) return dirRel;
  const rootRel = resolve(cwd, rp);
  return existsSync(rootRel) ? rootRel : dirRel;
}

// Sidecar-pointer marker written by scripts/split-large-agents.mjs when it
// promotes a heavy (>INLINE_CAP) row to its pull-only `<File>.AGENTS.md`. A row
// carrying it holds no inline detail, so it is excluded from the ROW_CAP count.
const SIDECAR_POINTER = /→ see `[^`]+\.AGENTS\.md`/;

/** Count INLINE DOX rows for the ROW_CAP over-threshold check. Excludes
 *  sidecar-pointer rows (pull-only, no per-turn injection detail). Sibling to
 *  parseRowPaths — never a replacement: parseRowPaths stays a COMPLETE path
 *  string[] (consumed cross-package by kb-extension acknowledgeRows/decideNudge
 *  + the missing/orphan/staleness checks); the exclusion is count-only. */
export function countInlineRows(agentsFile: string): number {
  if (!existsSync(agentsFile)) return 0;
  return scanDoxRows(readFileSync(agentsFile, "utf8")).rows.filter((r) => !SIDECAR_POINTER.test(r.line)).length;
}

/** Parse existing row paths from an AGENTS.md file. Rows are recognized by
 *  their table's `| File | Purpose |` header (design D1) — independent of
 *  heading structure. */
export function parseRowPaths(agentsFile: string): string[] {
  if (!existsSync(agentsFile)) return [];
  return scanDoxRows(readFileSync(agentsFile, "utf8")).rows.map((r) => r.path);
}

/** Source-file walk (delta ①②), exported for the file-index migration. */
export function sourceFiles(cwd: string, ignore?: GitignoreMatcher): string[] {
  return walkSource(cwd, [], ignore);
}

// delta ③: group source files by FULL parent dir (dirname), not the top-level
// segment — this is what makes the tree directory-level.
export function areaFiles(cwd: string, ignore?: GitignoreMatcher): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const f of walkSource(cwd, [], ignore)) {
    const rel = relative(cwd, f);
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".";
    (groups.get(dir) ?? groups.set(dir, []).get(dir)!).push(rel);
  }
  return groups;
}

/** Plan (and optionally write) a DOX tree. Idempotent: never clobbers existing
 *  AGENTS.md; only adds missing files + missing path rows. */
export function doxInit(opts: DoxInitOptions): DoxInitPlan {
  const cwd = opts.cwd;
  const gi = loadGitignoreMatcher(cwd, { cwd, prune: (rel) => DEFAULT_EXCLUDE.test(rel) });
  const plan: DoxInitPlan = { created: [], appended: [] };
  const groups = areaFiles(cwd, gi);

  const ensure = (agentsFile: string, rows: string[]) => {
    if (existsSync(agentsFile)) {
      const existing = new Set(parseRowPaths(agentsFile));
      const missRows = rows.filter((row) => {
        const m = row.match(/`([^`]+)`/);
        return m && !existing.has(m[1]);
      });
      if (missRows.length) plan.appended.push({ file: agentsFile, rows: missRows });
      // Table-aware append (design D2): rows land inside the file table, so a
      // rerun recognizes them and stays idempotent (an EOF-append outside any
      // table would re-fire as missing forever).
      if (!opts.dryRun && missRows.length) appendRowsToAgentsFile(agentsFile, missRows);
    } else {
      plan.created.push(agentsFile);
      if (!opts.dryRun) {
        mkdirSync(dirname(agentsFile), { recursive: true });
        writeFileSync(agentsFile, `# DOX — ${relative(cwd, dirname(agentsFile)) || "root"}\n\nFiles in this area. Purposes left for the agent to author.\n\n${FILE_TABLE_TEMPLATE}${rows.join("\n")}\n`, "utf8");
      }
    }
  };

  // delta ④ + granularity A: every directory holding ≥1 source file gets its own
  // AGENTS.md. No AREA_FILE_THRESHOLD gate, no part-N pseudo-dirs, no roll-up.
  // delta ⑤: rows are relative to each AGENTS.md's own directory.
  for (const [dir, rels] of groups) {
    const areaDir = dir === "." ? cwd : join(cwd, dir);
    const rows = rels
      .filter((r) => !AGENTS_FILES.includes(basename(r)))
      .map((r) => `| \`${basename(r)}\` |  |`);
    if (rows.length) ensure(join(areaDir, "AGENTS.md"), rows);
  }

  return plan;
}

// --- dox lint ---

/**
 * Pull repo-path REFERENCES out of a row's purpose cell.
 *
 * The lint hashes the file behind each row but never validates paths written
 * inside the prose, so a directory move silently rots cross-references (this is
 * how a routing rule kept pointing at two deleted dirs). The hard part is not
 * finding candidates — it is rejecting the ~99% that are not repo paths at all:
 * URL routes, MIME types, npm specifiers, `~`/absolute paths, model ids, code
 * fragments like `get/list/remove`, and descriptions of OTHER projects' layouts.
 *
 * Discriminators, in order of how much noise each removes:
 *  1. first segment must be a real top-level entry of THIS repo — kills
 *     `lib/validations.ts` (consumer-project prose) and `provider/model`
 *  2. must carry a source-file extension or be a glob — kills bare route paths
 *  3. structural rejects: leading `~` or `/`, `@` scopes, and any char that
 *     cannot appear in a path we would write (`:?="'()[]{}<>` , whitespace…)
 */
export function extractRefPaths(cell: string, topLevel: Set<string>): string[] {
  const out: string[] = [];
  for (const m of cell.matchAll(/`([^`]+)`/g)) {
    const raw = m[1].trim();
    if (!raw.includes("/")) continue;
    if (/^[~/@]/.test(raw)) continue; // home, absolute, npm scope
    if (/[:?="'()[\]{}<>|,;!#\s]/.test(raw)) continue; // routes, code, prose, placeholders
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional non-ASCII guard
    if (/[^\x20-\x7e]/.test(raw)) continue;
    const p = raw.replace(/^\.\//, "").replace(/\/$/, "");
    if (!p.includes("/")) continue;
    if (!topLevel.has(p.split("/")[0])) continue;
    if (!/\.[a-z0-9]{1,5}$/i.test(p) && !p.includes("*")) continue;
    // Build output and excluded trees (`packages/electron/out/*`, `.worktrees/*`)
    // are legitimately absent until built/created — flagging them is noise, and a
    // check that cries wolf gets ignored.
    if (DEFAULT_EXCLUDE.test(p)) continue;
    out.push(p);
  }
  return out;
}

/** Cheap glob test for `*` / `**` reference paths (no dependency on a matcher). */
function globHit(pattern: string, cwd: string): boolean {
  const rx = new RegExp(
    `^${pattern
      .split("/")
      .map((s) =>
        s
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*/g, "\u0001")
          .replace(/\*/g, "[^/]*")
          .replace(/\u0001/g, ".*"),
      )
      .join("/")}$`,
  );
  const walk = (dir: string, rel: string): boolean => {
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (DEFAULT_EXCLUDE.test(r)) continue;
      if (rx.test(r)) return true;
      if (e.isDirectory() && walk(join(dir, e.name), r)) return true;
    }
    return false;
  };
  return walk(cwd, "");
}

export interface DoxIssue {
  kind: "stale" | "orphan" | "missing" | "missing-companion" | "broken-pointer" | "broken-ref" | "zero-row-table" | "over-threshold";
  agentsFile: string;
  path?: string;
  detail: string;
  // over-threshold discriminator: "bytes" = actionable (auto-injected per turn,
  // remedy = sidecar split); "rows" = informational (advisory, no injection cost).
  // missing discriminator: "source" = an undocumented .ts/.tsx (design D9), which
  // is opt-in and never auto-fixed; markdown `missing` findings carry no arm.
  arm?: "bytes" | "rows" | "source";
}
export interface DoxLintOptions {
  json?: boolean;
  fix?: boolean;
  cwd: string;
  stalenessFile?: string; // sidecar path (source-path → ack-hash)
  /** Opt-in: report undocumented SOURCE files as `missing` (design D9). OFF by
   *  default so an existing tree can adopt the arm incrementally instead of
   *  red-walling CI with a large one-time finding count. */
  sourceFileRows?: boolean;
}
export interface DoxLintResult {
  issues: DoxIssue[];
  fixed: number;
  /** Coverage (design D4): AGENTS.md files row-parsed, so a clean verdict can
   *  be distinguished from an unread file. */
  filesScanned: number;
  /** Recognized rows across all scanned files. */
  rowsScanned: number;
}

function fileSha(p: string): string {
  try { return createHash("sha256").update(readFileSync(p)).digest("hex"); } catch { return ""; }
}
function loc(p: string): number {
  try { return readFileSync(p, "utf8").split("\n").length; } catch { return 0; }
}

export function doxLint(opts: DoxLintOptions): DoxLintResult {
  const cwd = opts.cwd;
  const issues: DoxIssue[] = [];
  let fixed = 0;
  let filesScanned = 0;
  let rowsScanned = 0;

  // Gitignore-aware walk predicate (design D3), seeded from the repo root so
  // root-anchored patterns apply even though the walk starts at cwd.
  const gi = loadGitignoreMatcher(cwd, { cwd, prune: (rel) => DEFAULT_EXCLUDE.test(rel) });

  // Top-level entries of THIS repo — the primary discriminator that stops
  // broken-ref from firing on prose that merely looks path-shaped.
  const topLevelEntries = new Set<string>();
  try {
    for (const e of readdirSync(cwd, { withFileTypes: true })) topLevelEntries.add(e.name);
  } catch {
    /* empty cwd — leave the set empty, which disables broken-ref entirely */
  }
  const seenRefs = new Set<string>();

  // find all AGENTS.md
  const agentsFiles: string[] = [];
  // Test the path RELATIVE to cwd (mirrors walkFiles) so an ancestor dir named
  // like an excluded token (e.g. running inside .worktrees) does not nuke the
  // whole walk and yield 0 issues.
  const walkAgents = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      if (DEFAULT_EXCLUDE.test(relative(cwd, abs))) continue;
      if (e.isDirectory()) {
        const rel = relative(cwd, abs);
        if (gi.isIgnoredDir(rel) && !gi.hasDeeperGitignore(rel)) continue;
        walkAgents(abs);
      } else if (e.name === "AGENTS.md" && !gi.isIgnored(relative(cwd, abs))) agentsFiles.push(abs);
    }
  };
  walkAgents(cwd);

  // staleness sidecar — v1 (sha strings) / v2 (records with stat baseline)
  // tolerant reader shared with triage, ack-on-edit, and query-time verdicts.
  const sf = opts.stalenessFile ?? join(cwd, ".pi", "dashboard", "kb", "dox-staleness.json");
  const staleness = readStaleness(sf);

  const allMd = new Set(walkMd(cwd, [], gi).map((f) => relative(cwd, f)));
  const rowPaths = new Set<string>();

  for (const af of agentsFiles) {
    const afRel = relative(cwd, af);
    // over-threshold splits into two arms with distinct severity:
    //  - byte arm (actionable): file auto-injected per turn past the byte cap;
    //    remedy = file-based sidecar split (promote heaviest rows).
    //  - row arm (informational): more than ROW_CAP INLINE rows but within the
    //    byte cap — no per-turn injection cost; optional directory foldering.
    // Row arm counts INLINE rows only (sidecar-pointer rows excluded) so a
    // split reduces both the byte total AND the counted-row total.
    const afBytes = statSync(af).size;
    if (afBytes > AGENTS_BYTE_CAP) issues.push({ kind: "over-threshold", agentsFile: afRel, arm: "bytes", detail: `${afBytes} bytes > cap ${AGENTS_BYTE_CAP}; auto-injected per turn — actionable: promote heaviest rows to <File>.AGENTS.md sidecars` });
    const inlineCount = countInlineRows(af);
    if (inlineCount > ROW_CAP) issues.push({ kind: "over-threshold", agentsFile: afRel, arm: "rows", detail: `${inlineCount} inline rows > cap ${ROW_CAP}; informational (advisory; no per-turn injection cost) — optional: folder into cohesive subdirectories` });
    filesScanned++;
    const text = readFileSync(af, "utf8");
    const scan = scanDoxRows(text);
    rowsScanned += scan.rows.length;
    // A file-row table nobody filled is a finding, not silence (design D4).
    for (const t of scan.emptyFileTables) {
      issues.push({ kind: "zero-row-table", agentsFile: afRel, detail: `file-row table header at line ${t.line + 1} has zero recognized rows` });
    }
    const pruneIdx = new Set<number>();
    const afDir = dirname(af);
    for (const row of scan.rows) {
      const rp = row.path;
      const line = row.line;
      // Cross-references inside the PURPOSE cell. Rot here is invisible to the
      // hash check, because the row's own file is untouched by the move.
      const purposeCell = line.slice(line.indexOf("|", line.indexOf("`" + rp + "`")) + 1);
      for (const ref of extractRefPaths(purposeCell, topLevelEntries)) {
        if (seenRefs.has(ref)) continue;
        seenRefs.add(ref);
        const hit = ref.includes("*")
          ? globHit(ref, cwd)
          : existsSync(join(cwd, ref)) || existsSync(join(afDir, ref));
        if (!hit) issues.push({ kind: "broken-ref", agentsFile: afRel, path: ref, detail: `broken-ref: row prose cites ${ref}, which does not exist` });
      }
      const abs = resolveRowPath(afDir, cwd, rp);
      const rel = relative(cwd, abs);
      rowPaths.add(rel);
      if (!existsSync(abs)) {
        // could be a broken pointer to an area AGENTS.md, or an orphan source row
        const kind = rp.endsWith("AGENTS.md") ? "broken-pointer" : "orphan";
        issues.push({ kind, agentsFile: afRel, path: rp, detail: `${kind}: ${rp} does not exist` });
        if (opts.fix && kind === "orphan") {
          fixed++;
          pruneIdx.add(row.lineIndex); // prune the orphan line, keep every other line byte-identical
        }
      } else if (staleness[rel]?.sha256) {
        const diskSha = fileSha(abs);
        if (diskSha && staleness[rel]!.sha256 !== diskSha) {
          issues.push({ kind: "stale", agentsFile: afRel, path: rp, detail: `tracked source-hash drifted` });
        }
      }
    }
    if (opts.fix && pruneIdx.size > 0) {
      const out = text.split("\n").filter((_, idx) => !pruneIdx.has(idx));
      writeFileSync(af, out.join("\n"), "utf8");
    }
  }

  // missing rows: md files in an area (dir containing an AGENTS.md) with no row.
  // Owner = nearest ancestor AGENTS.md (deepest dir prefix of the file's dir).
  const ownerOf = (mdDir: string): string | null => {
    let best: string | null = null;
    let bestDepth = -1;
    for (const af of agentsFiles) {
      const aDir = relative(cwd, dirname(af)) || ".";
      const prefix = aDir === "." ? "" : aDir + "/";
      if (mdDir === aDir || mdDir.startsWith(prefix)) {
        const depth = aDir.split("/").filter(Boolean).length;
        if (depth > bestDepth) { best = af; bestDepth = depth; }
      }
    }
    return best;
  };
  for (const md of allMd) {
    if (rowPaths.has(md)) continue;
    const dir = md.includes("/") ? md.slice(0, md.lastIndexOf("/")) : ".";
    const owner = ownerOf(dir);
    if (owner) {
      const ownerRel = relative(cwd, owner) || "AGENTS.md";
      issues.push({ kind: "missing", agentsFile: ownerRel, path: md, detail: `no row for ${md}` });
      // Table-aware append (design D2): an EOF-append outside the table would
      // never be recognized again — the finding would re-fire forever.
      if (opts.fix) {
        appendRowsToAgentsFile(owner, [`| \`${md}\` |  |`]);
        fixed++;
      }
    }
  }

  // missing rows, SOURCE arm (design D9): a .ts/.tsx in a covered area with no
  // row in ANY ancestor AGENTS.md and no <file>.AGENTS.md sidecar is unreachable
  // through the `agents` doc-type lane that retrieval depends on. Opt-in, and
  // never auto-fixed: a blank purpose row is worse than an honest finding.
  if (opts.sourceFileRows) {
    for (const abs of sourceFiles(cwd, gi)) {
      const rel = relative(cwd, abs);
      if (rowPaths.has(rel)) continue;
      if (existsSync(join(cwd, `${rel}.AGENTS.md`))) continue;
      const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".";
      const owner = ownerOf(dir);
      if (!owner) continue;
      issues.push({ kind: "missing", arm: "source", agentsFile: relative(cwd, owner) || "AGENTS.md", path: rel, detail: `no row for source file ${rel}` });
    }
  }

  // missing companions: large source/md files with no <file>.agent.md
  for (const md of allMd) {
    const abs = join(cwd, md);
    if (loc(abs) > COMPANION_LOC || statSync(abs).size > COMPANION_BYTES) {
      const comp = md.replace(/\.mdx?$/i, ".agent.md");
      if (!existsSync(join(cwd, comp))) issues.push({ kind: "missing-companion", agentsFile: comp, path: md, detail: `${md} past threshold, no ${comp}` });
    }
  }

  return { issues, fixed, filesScanned, rowsScanned };
}

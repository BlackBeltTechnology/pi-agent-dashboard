// DOX tree: directory-level AGENTS.md scaffolding + audit, and the
// `kb agents <path>` nearest-applicable chain (design §6d). Pure-local,
// deterministic, no LLM/embedding. The detect-don't-write rule: `dox init`
// and `--fix` only fill PATH columns / prune orphans; the LLM authors purposes.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import type { KbStore } from "./types.js";

// delta ②: exclude worktree checkouts, archived openspec proposals, and doc-example noise
const DEFAULT_EXCLUDE = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|\.kb|\.pi|\.worktrees|openspec|doc-example)(\/|$)/;
const AGENTS_FILES = ["AGENTS.md"];
// delta ①: dox init now maps SOURCE, not docs. Source globs, minus type decls and tests.
const SOURCE_EXT = /\.(ts|tsx|js|jsx)$/;
const MD_EXT = /\.(md|mdx)$/i;
function isSourceFile(name: string): boolean {
  return SOURCE_EXT.test(name) && !/\.d\.ts$/.test(name) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(name);
}
function isMdFile(name: string): boolean {
  // `*.AGENTS.md` sidecars are per-file index promotions, not doc md needing
  // their own dir row/companion — exclude from the md walk.
  return MD_EXT.test(name) && !AGENTS_FILES.includes(name) && !name.endsWith(".AGENTS.md");
}
export const AREA_FILE_THRESHOLD = 8; // ≥ this many md files in a subdir → own AGENTS.md
export const ROW_CAP = 40;
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
    for (const name of names) {
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
function walkFiles(dir: string, match: (name: string) => boolean, out: string[] = [], root: string = dir): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (DEFAULT_EXCLUDE.test(relative(root, abs))) continue;
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      walkFiles(abs, match, out, root);
    } else if (match(e.name)) out.push(abs);
  }
  return out;
}
function walkMd(dir: string, out: string[] = []): string[] {
  return walkFiles(dir, isMdFile, out);
}
function walkSource(dir: string, out: string[] = []): string[] {
  return walkFiles(dir, isSourceFile, out);
}

/** Parse existing row paths from an AGENTS.md file. */
export function parseRowPaths(agentsFile: string): string[] {
  if (!existsSync(agentsFile)) return [];
  const text = readFileSync(agentsFile, "utf8");
  const paths: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (m) paths.push(m[1]);
  }
  return paths;
}

/** Source-file walk (delta ①②), exported for the file-index migration. */
export function sourceFiles(cwd: string): string[] {
  return walkSource(cwd);
}

// delta ③: group source files by FULL parent dir (dirname), not the top-level
// segment — this is what makes the tree directory-level.
export function areaFiles(cwd: string): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const f of walkSource(cwd)) {
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
  const plan: DoxInitPlan = { created: [], appended: [] };
  const groups = areaFiles(cwd);

  const ensure = (agentsFile: string, rows: string[]) => {
    if (existsSync(agentsFile)) {
      const existing = new Set(parseRowPaths(agentsFile));
      const missRows = rows.filter((row) => {
        const m = row.match(/`([^`]+)`/);
        return m && !existing.has(m[1]);
      });
      if (missRows.length) plan.appended.push({ file: agentsFile, rows: missRows });
      if (!opts.dryRun && missRows.length) appendFileSync(agentsFile, "\n" + missRows.join("\n") + "\n");
    } else {
      plan.created.push(agentsFile);
      if (!opts.dryRun) {
        mkdirSync(dirname(agentsFile), { recursive: true });
        writeFileSync(agentsFile, `# DOX — ${relative(cwd, dirname(agentsFile)) || "root"}\n\nFiles in this area. Purposes left for the agent to author.\n\n${rows.join("\n")}\n`, "utf8");
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

export interface DoxIssue {
  kind: "stale" | "orphan" | "missing" | "missing-companion" | "broken-pointer" | "over-threshold";
  agentsFile: string;
  path?: string;
  detail: string;
}
export interface DoxLintOptions {
  json?: boolean;
  fix?: boolean;
  cwd: string;
  stalenessFile?: string; // sidecar path (source-path → ack-hash)
}
export interface DoxLintResult {
  issues: DoxIssue[];
  fixed: number;
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

  // find all AGENTS.md
  const agentsFiles: string[] = [];
  const walkAgents = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      if (DEFAULT_EXCLUDE.test(abs)) continue;
      if (e.isDirectory()) walkAgents(abs);
      else if (e.name === "AGENTS.md") agentsFiles.push(abs);
    }
  };
  walkAgents(cwd);

  // staleness sidecar
  let staleness: Record<string, string> = {};
  const sf = opts.stalenessFile ?? join(cwd, ".pi", "dashboard", "kb", "dox-staleness.json");
  if (existsSync(sf)) { try { staleness = JSON.parse(readFileSync(sf, "utf8")); } catch { /* */ } }

  const allMd = new Set(walkMd(cwd).map((f) => relative(cwd, f)));
  const rowPaths = new Set<string>();

  for (const af of agentsFiles) {
    const rows = parseRowPaths(af);
    const afRel = relative(cwd, af);
    // over-threshold: row count OR byte size. Fix = split file-based (promote
    // heaviest rows to `<File>.AGENTS.md` sidecars + cap remaining rows).
    if (rows.length > ROW_CAP) issues.push({ kind: "over-threshold", agentsFile: afRel, detail: `${rows.length} rows > cap ${ROW_CAP}; promote heaviest rows to <File>.AGENTS.md sidecars` });
    const afBytes = statSync(af).size;
    if (afBytes > AGENTS_BYTE_CAP) issues.push({ kind: "over-threshold", agentsFile: afRel, detail: `${afBytes} bytes > cap ${AGENTS_BYTE_CAP}; auto-injected per turn — promote heaviest rows to <File>.AGENTS.md sidecars` });
    const survivingRows: string[] = [];
    const text = readFileSync(af, "utf8").split("\n");
    for (const line of text) {
      const m = line.match(/^\|\s*`([^`]+)`\s*\|/);
      if (!m) { if (opts.fix) survivingRows.push(line); continue; }
      const rp = m[1];
      rowPaths.add(rp);
      const abs = isAbsolute(rp) ? rp : resolve(cwd, rp);
      if (!existsSync(abs)) {
        // could be a broken pointer to an area AGENTS.md, or an orphan source row
        const kind = rp.endsWith("AGENTS.md") ? "broken-pointer" : "orphan";
        issues.push({ kind, agentsFile: afRel, path: rp, detail: `${kind}: ${rp} does not exist` });
        if (opts.fix && kind === "orphan") { fixed++; continue; } // prune orphan row
      } else if (staleness[rp] && fileSha(abs) && staleness[rp] !== fileSha(abs)) {
        issues.push({ kind: "stale", agentsFile: afRel, path: rp, detail: `tracked source-hash drifted` });
      }
      if (opts.fix) survivingRows.push(line);
    }
    if (opts.fix) writeFileSync(af, survivingRows.join("\n") + "\n", "utf8");
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
      if (opts.fix) { appendFileSync(owner, `| \`${md}\` |  |\n`); fixed++; }
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

  return { issues, fixed };
}

// Pure reindex + DOX-nudge logic, factored out of the pi hook so it is testable
// without a running pi. The extension (extension.ts) wires these to
// `pi.on("tool_result")` + `pi.registerTool`; this module has no pi imports.
//
// Job 1 (always on when the extension loads): a write/edit to a `.md` file
// triggers a debounced, hash-gated incremental reindex.
// Job 2 (opt-in via doxEnforcement, default OFF): a write/edit to a non-md
// source file nudges the nearest AGENTS.md row upkeep, once per path, deduped.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadConfig, type ResolvedConfig } from "@blackbelt-technology/pi-dashboard-kb";
import { SqliteFtsStore } from "@blackbelt-technology/pi-dashboard-kb";
import { indexSource } from "@blackbelt-technology/pi-dashboard-kb";
import { agentsChain, parseRowPaths } from "@blackbelt-technology/pi-dashboard-kb";

/** Resolve a DOX row path relative to its AGENTS.md dir, with a project-root
 *  fallback (a nested AGENTS.md may document a file living at the root).
 *  Local mirror of kb's `resolveRowPath` — kept inline so this package does not
 *  depend on an unreleased kb export across the versioned package boundary. */
function resolveRowPath(agentsDir: string, cwd: string, rp: string): string {
  if (isAbsolute(rp)) return rp;
  const dirRel = resolve(agentsDir, rp);
  if (existsSync(dirRel)) return dirRel;
  const rootRel = resolve(cwd, rp);
  return existsSync(rootRel) ? rootRel : dirRel;
}

export const DEFAULT_DEBOUNCE_MS = 800;

export interface ReindexState {
  timers: Map<string, ReturnType<typeof setTimeout>>;
  nudged: Set<string>; // dedup keys already nudged this session
  // KB handles cached PER cwd — a dashboard session may switch project folders;
  // a single shared store would index the wrong DB after a switch.
  kb: Map<string, { store: SqliteFtsStore; cfg: ResolvedConfig }>;
  // In-flight reindex per cwd. `indexSource` now yields mid-transaction, so two
  // overlapping walks on the same cached store (debounce timer + kb_search
  // freshness) would interleave BEGIN/COMMIT and corrupt the transaction.
  // Coalesce them onto one walk. See change: fix-kb-index-feedback.
  inflight: Map<string, Promise<{ changed: number; chunks: number }>>;
}

export function createReindexState(): ReindexState {
  return { timers: new Map(), nudged: new Set(), kb: new Map(), inflight: new Map() };
}

function stalenessPath(cwd: string): string {
  return join(cwd, ".pi", "dashboard", "kb", "dox-staleness.json");
}
function loadStaleness(cwd: string): Record<string, string> {
  const p = stalenessPath(cwd);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
}
function saveStaleness(cwd: string, map: Record<string, string>): void {
  const p = stalenessPath(cwd);
  try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(map, null, 2)); } catch { /* */ }
}
function fileSha(p: string): string {
  try { return createHash("sha256").update(readFileSync(p)).digest("hex"); } catch { return ""; }
}

/** Editing an AGENTS.md acknowledges its rows (clears their stale flags). */
export function acknowledgeRows(cwd: string, agentsFile: string): void {
  const abs = isAbsolute(agentsFile) ? agentsFile : resolve(cwd, agentsFile);
  if (!existsSync(abs)) return;
  const dir = dirname(abs);
  const map = loadStaleness(cwd);
  for (const rp of parseRowPaths(abs)) {
    // Rows are relative to their AGENTS.md dir; key staleness by cwd-relative path.
    const ap = resolveRowPath(dir, cwd, rp);
    if (existsSync(ap)) map[relative(cwd, ap)] = fileSha(ap);
  }
  saveStaleness(cwd, map);
}

export type NudgeDecision =
  | { kind: "treeless" }
  | { kind: "missing"; agentsFile: string }
  | { kind: "stale"; agentsFile: string }
  | null;

/** Decide whether a non-md source edit should nudge DOX upkeep. Pure. */
export function decideNudge(cwd: string, editedPath: string): NudgeDecision {
  const abs = isAbsolute(editedPath) ? editedPath : resolve(cwd, editedPath);
  const { chain } = agentsChain(cwd, abs, { claudeMd: true });
  if (chain.length === 0) return { kind: "treeless" };
  const nearest = chain[chain.length - 1];
  // Rows document paths relative to their own AGENTS.md dir — resolve before compare.
  const nearestDir = dirname(nearest.path);
  const rowAbs = new Set(parseRowPaths(nearest.path).map((rp) => resolveRowPath(nearestDir, cwd, rp)));
  const rel = relative(cwd, abs) || abs;
  if (!rowAbs.has(abs)) return { kind: "missing", agentsFile: nearest.rel };
  const map = loadStaleness(cwd);
  const disk = fileSha(abs);
  if (map[rel] && disk && map[rel] !== disk) return { kind: "stale", agentsFile: nearest.rel };
  return null;
}

/** Render the nudge text for a decision. */
export function nudgeText(decision: NudgeDecision, editedPath: string): string | null {
  if (!decision) return null;
  if (decision.kind === "treeless") return `[kb] Edited \`${editedPath}\` but no AGENTS.md covers it. Run \`kb dox init\` to bootstrap a DOX tree.`;
  return `[kb] Edited \`${editedPath}\`. Update its row in \`${decision.agentsFile}\` (it is ${decision.kind === "missing" ? "missing a row" : "stale"}).`;
}

/** Lazily open (and cache) the KB store + config for a cwd. */
export function getKb(state: ReindexState, cwd: string): { store: SqliteFtsStore; cfg: ResolvedConfig } {
  let entry = state.kb.get(cwd);
  if (!entry) {
    const cfg = loadConfig(cwd);
    const store = new SqliteFtsStore(cfg.dbAbsPath);
    store.init();
    entry = { store, cfg };
    state.kb.set(cwd, entry);
  }
  return entry;
}

/** Reindex filesystem sources now (called after debounce). Hash-gated via the
 *  indexer's mtime→sha256 incremental pass. */
export function reindexNow(state: ReindexState, cwd: string): Promise<{ changed: number; chunks: number }> {
  // Coalesce concurrent reindexes for one cwd onto a single in-flight walk
  // (they share a cached store; overlapping async walks would interleave the
  // batched transaction). See change: fix-kb-index-feedback.
  const existing = state.inflight.get(cwd);
  if (existing) return existing;
  const p = (async () => {
    const { store, cfg } = getKb(state, cwd);
    let changed = 0, chunks = 0;
    for (const s of cfg.resolvedSources) {
      const st = await indexSource(store, { root: s.id, dir: s.dir }, { indexAgentsFiles: cfg.indexAgentsFiles, includeSourceMarkdown: cfg.includeSourceMarkdown, include: cfg.include, exclude: cfg.exclude, extensions: cfg.extensions });
      changed += st.changed; chunks += st.chunks;
    }
    return { changed, chunks };
  })().finally(() => {
    if (state.inflight.get(cwd) === p) state.inflight.delete(cwd);
  });
  state.inflight.set(cwd, p);
  return p;
}

/** Schedule a debounced reindex for an edited .md path. */
export function scheduleReindex(state: ReindexState, cwd: string, _path: string, debounceMs = DEFAULT_DEBOUNCE_MS): void {
  const key = cwd;
  const existing = state.timers.get(key);
  if (existing) clearTimeout(existing);
  state.timers.set(key, setTimeout(() => {
    state.timers.delete(key);
    reindexNow(state, cwd).catch((e) => console.warn(`[kb] reindex failed: ${(e as Error).message}`));
  }, debounceMs));
}

/** Close any cached store (on session_shutdown). */
export function closeKb(state: ReindexState): void {
  for (const { store } of state.kb.values()) { try { store.close(); } catch { /* */ } }
  state.kb.clear();
  for (const t of state.timers.values()) clearTimeout(t);
  state.timers.clear();
}

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

export const DEFAULT_DEBOUNCE_MS = 800;

export interface ReindexState {
  timers: Map<string, ReturnType<typeof setTimeout>>;
  nudged: Set<string>; // dedup keys already nudged this session
  // KB handles cached PER cwd — a dashboard session may switch project folders;
  // a single shared store would index the wrong DB after a switch.
  kb: Map<string, { store: SqliteFtsStore; cfg: ResolvedConfig }>;
}

export function createReindexState(): ReindexState {
  return { timers: new Map(), nudged: new Set(), kb: new Map() };
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
  const map = loadStaleness(cwd);
  for (const rp of parseRowPaths(abs)) {
    const ap = isAbsolute(rp) ? rp : resolve(cwd, rp);
    if (existsSync(ap)) map[rp] = fileSha(ap);
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
  const rows = parseRowPaths(nearest.path);
  const rel = relative(cwd, abs) || abs;
  if (!rows.includes(rel)) return { kind: "missing", agentsFile: nearest.rel };
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
export function reindexNow(state: ReindexState, cwd: string): { changed: number; chunks: number } {
  const { store, cfg } = getKb(state, cwd);
  let changed = 0, chunks = 0;
  for (const s of cfg.resolvedSources) {
    const st = indexSource(store, { root: s.id, dir: s.dir }, { indexAgentsFiles: cfg.indexAgentsFiles, includeSourceMarkdown: cfg.includeSourceMarkdown, include: cfg.include, exclude: cfg.exclude, extensions: cfg.extensions });
    changed += st.changed; chunks += st.chunks;
  }
  return { changed, chunks };
}

/** Schedule a debounced reindex for an edited .md path. */
export function scheduleReindex(state: ReindexState, cwd: string, _path: string, debounceMs = DEFAULT_DEBOUNCE_MS): void {
  const key = cwd;
  const existing = state.timers.get(key);
  if (existing) clearTimeout(existing);
  state.timers.set(key, setTimeout(() => {
    state.timers.delete(key);
    try { reindexNow(state, cwd); } catch (e) { console.warn(`[kb] reindex failed: ${(e as Error).message}`); }
  }, debounceMs));
}

/** Close any cached store (on session_shutdown). */
export function closeKb(state: ReindexState): void {
  for (const { store } of state.kb.values()) { try { store.close(); } catch { /* */ } }
  state.kb.clear();
  for (const t of state.timers.values()) clearTimeout(t);
  state.timers.clear();
}

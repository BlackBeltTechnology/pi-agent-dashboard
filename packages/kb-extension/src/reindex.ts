// Pure reindex + DOX-nudge logic, factored out of the pi hook so it is testable
// without a running pi. The extension (extension.ts) wires these to
// `pi.on("tool_result")` + `pi.registerTool`; this module has no pi imports.
//
// Job 1 (always on when the extension loads): a write/edit to a `.md` file
// triggers a debounced, hash-gated incremental reindex.
// Job 2 (opt-in via doxEnforcement, default OFF): a write/edit to a non-md
// source file nudges the nearest AGENTS.md row upkeep, once per path, deduped.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  type AckRecord,
  agentsChain,
  beginForcedSource,
  indexOptionsFromConfig,
  indexSource,
  isFirstIndexLive,
  loadConfig,
  parseRowPaths,
  type ResolvedConfig,
  readStaleness,
  runIndexAtomic,
  SqliteFtsStore,
  STALENESS_VERSION,
  seedOptionsFromConfig,
  sourceGateIsStale,
  stalenessVersionOnDisk,
  stampPass,
  stampSource,
} from "@blackbelt-technology/pi-dashboard-kb";

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
  // cwds for which a REAL pass (every source's `indexSource` resolved) has finished
  // successfully in this process. Distinguishes "index still being built" from
  // "legitimately empty". Not set by the removed-cwd no-op, the warm `if-empty`
  // skip or a rejected pass; forgotten on close. See change: bound-kb-search-freshness.
  completed: Set<string>;
}

export function createReindexState(): ReindexState {
  return { timers: new Map(), nudged: new Set(), kb: new Map(), inflight: new Map(), completed: new Set() };
}

// --- freshness budget (change: bound-kb-search-freshness) ---

export const DEFAULT_FRESHNESS_BUDGET_MS = 1500;
export const MAX_FRESHNESS_BUDGET_MS = 60000;

/** Resolve `KB_FRESHNESS_BUDGET_MS`. Trimmed; absent/empty → default; strict
 *  non-negative decimal integer → itself (`0` = never wait), clamped to the
 *  ceiling; anything else (`-1`, `1.5`, `1e3`, `10ms`) → default. */
export function resolveFreshnessBudgetMs(raw: string | undefined): number {
  const v = (raw ?? "").trim();
  if (!/^\d+$/.test(v)) return DEFAULT_FRESHNESS_BUDGET_MS;
  const n = Number(v);
  return Math.min(n, MAX_FRESHNESS_BUDGET_MS);
}

/** Model-facing status lines (text channel; `details` is rendering-only). */
export const STALE_LINE = "(index refresh still running — results may be stale)";
export const BUILDING_LINE = "(index is still being built — no results available yet; retry shortly)";
export const CANCELLED_LINE = "(cancelled — no results retrieved)";

export type FreshnessOutcome = "done" | "timeout" | "failed" | "aborted" | "building";
export type FreshnessStatus = "none" | "stale" | "building" | "cancelled";

/** Outcome → which status line applies (one rule for all three tools). */
export function freshnessStatus(state: ReindexState, cwd: string, outcome: FreshnessOutcome): FreshnessStatus {
  if (outcome === "done") return "none";
  if (outcome === "aborted") return "cancelled";
  if (outcome === "building") return "building"; // another process is building the first index
  if (outcome === "failed") return "stale"; // never "building": a deterministic failure would say "retry shortly" forever
  let chunks = 1;
  try {
    chunks = getKb(state, cwd)?.store.counts().chunks ?? 0; // no index file yet = no chunks
  } catch { /* can't tell → treat as populated (stale label, never a false "building") */ }
  return chunks === 0 && !state.completed.has(cwd) ? "building" : "stale";
}

function stalenessPath(cwd: string): string {
  return join(cwd, ".pi", "dashboard", "kb", "dox-staleness.json");
}
/** Tolerant reader (v1 sha-only / v2 records / future rejected) — kb's
 *  `readStaleness`, shared verbatim with lint + triage + query-time verdicts
 *  so all four agree on what "acknowledged" means. */
function loadStaleness(cwd: string): Record<string, AckRecord> {
  return readStaleness(stalenessPath(cwd));
}
/** Acknowledgement writes v2: hash + stat baseline per documented file.
 *  Fail-closed on a NEWER on-disk version — never stomp records we cannot read. */
function saveStaleness(cwd: string, map: Record<string, AckRecord>): void {
  const p = stalenessPath(cwd);
  const onDisk = stalenessVersionOnDisk(p);
  if (onDisk != null && onDisk > STALENESS_VERSION) {
    console.warn(`[kb] dox-staleness.json is version ${onDisk} (> supported ${STALENESS_VERSION}); skipping ack write`);
    return;
  }
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify({ version: STALENESS_VERSION, files: map }, null, 2)}\n`);
  } catch { /* */ }
}
function fileSha(p: string): string {
  try { return createHash("sha256").update(readFileSync(p)).digest("hex"); } catch { return ""; }
}

/** Editing an AGENTS.md acknowledges its rows (clears their stale flags) —
 *  recording sha256 + stat baseline (v2) so query-time freshness can skip the read. */
export function acknowledgeRows(cwd: string, agentsFile: string): void {
  const abs = isAbsolute(agentsFile) ? agentsFile : resolve(cwd, agentsFile);
  if (!existsSync(abs)) return;
  const dir = dirname(abs);
  const map = loadStaleness(cwd);
  for (const rp of parseRowPaths(abs)) {
    // Rows are relative to their AGENTS.md dir; key staleness by cwd-relative path.
    const ap = resolveRowPath(dir, cwd, rp);
    let st;
    try {
      st = statSync(ap); // may vanish between existsSync and here (TOCTOU) — skip the row, keep the rest of the ack
    } catch {
      continue;
    }
    map[relative(cwd, ap)] = { sha256: fileSha(ap), size: st.size, mtimeMs: st.mtimeMs };
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
  if (map[rel]?.sha256 && disk && map[rel]!.sha256 !== disk) return { kind: "stale", agentsFile: nearest.rel };
  return null;
}

/** Render the nudge text for a decision. */
export function nudgeText(decision: NudgeDecision, editedPath: string): string | null {
  if (!decision) return null;
  if (decision.kind === "treeless") return `[kb] Edited \`${editedPath}\` but no AGENTS.md covers it. Run \`kb dox init\` to bootstrap a DOX tree.`;
  return `[kb] Edited \`${editedPath}\`. Update its row in \`${decision.agentsFile}\` (it is ${decision.kind === "missing" ? "missing a row" : "stale"}).`;
}

/** Lazily open (and cache) the KB store + config for a cwd. NEVER creates the docs
 *  database: an absent `dbPath` yields `null` — only the atomic first-index path
 *  (`reindexNow`) creates it, so a file at `dbPath` always means a first index
 *  completed and this process can never plant a WAL pair under a finished build's
 *  install. See change: fix-kb-index-integrity (D2).
 *
 *  Refuses to construct a fresh store when `cwd` no longer exists on disk: a
 *  `new SqliteFtsStore` runs `mkdirSync(dirname(dbPath), {recursive:true})`,
 *  which would RE-CREATE `<cwd>/.pi/dashboard/kb` by path after the worktree
 *  was removed — resurrecting an orphan husk. A cache HIT still returns the
 *  live handle (the caller opened it while the cwd existed). See change:
 *  sweep-worktree-residual-on-remove. */
export function getKb(state: ReindexState, cwd: string): { store: SqliteFtsStore; cfg: ResolvedConfig } | null {
  let entry = state.kb.get(cwd);
  if (!entry) {
    if (!existsSync(cwd)) {
      throw new Error(`kb: cwd removed, refusing to recreate store: ${cwd}`);
    }
    const cfg = loadConfig(cwd);
    if (!existsSync(cfg.dbAbsPath)) return null;
    const store = new SqliteFtsStore(cfg.dbAbsPath);
    store.init();
    entry = { store, cfg };
    state.kb.set(cwd, entry);
  }
  return entry;
}

/** Shared empty in-memory store: what a pull tool queries when no docs database exists
 *  yet and nothing is building one (e.g. no indexable source directory). Read-only use. */
let emptyStore: SqliteFtsStore | null = null;
/** `getKb`, or an empty store + the cwd's config when the database does not exist. */
export function getKbOrEmpty(state: ReindexState, cwd: string): { store: SqliteFtsStore; cfg: ResolvedConfig } {
  const kb = getKb(state, cwd);
  if (kb) return kb;
  if (!emptyStore) {
    emptyStore = new SqliteFtsStore(":memory:");
    emptyStore.init();
  }
  return { store: emptyStore, cfg: loadConfig(cwd) };
}

/** Another process is building the cwd's first index: the docs database is absent and a
 *  live foreign `<dbPath>.tmp-<pid>` marker exists. Consulted only while `dbPath` is
 *  absent (a cached store means it exists). */
export function foreignFirstIndexLive(state: ReindexState, cwd: string): boolean {
  if (state.kb.has(cwd) || !existsSync(cwd)) return false;
  try {
    const { dbAbsPath } = loadConfig(cwd);
    return !existsSync(dbAbsPath) && isFirstIndexLive(dbAbsPath);
  } catch {
    return false;
  }
}

type ReindexResult = { changed: number; chunks: number };

/** No docs database yet. Another process building it → skip silently (the debounced path logs
 *  nothing); otherwise build THROUGH the atomic first-index path (temp file → no-clobber
 *  install) — never an in-place open of `dbPath`. */
async function buildFirstIndex(state: ReindexState, cwd: string): Promise<ReindexResult> {
  const cfg = loadConfig(cwd);
  if (isFirstIndexLive(cfg.dbAbsPath)) return { changed: 0, chunks: 0 };
  const sources = cfg.resolvedSources.map((s) => ({ id: s.id, dir: s.dir }));
  // Nothing indexable on disk: a completed (empty) pass; no file is created.
  const r = sources.some((s) => existsSync(s.dir))
    ? await runIndexAtomic({ dbPath: cfg.dbAbsPath, sources, indexOpts: indexOptionsFromConfig(cfg), gate: cfg, log: warnInstallFailure, seed: seedOptionsFromConfig(cfg) })
    : { changed: 0, chunks: 0 };
  if (existsSync(cwd)) state.completed.add(cwd);
  return { changed: r.changed, chunks: r.chunks };
}

/** Incremental pass over an existing database. One source throwing must not stop the others; its
 *  gate record stays unwritten so the next pass forces it again. The first failure is rethrown
 *  after the loop so the pass still counts as failed (never as completed). */
async function reindexExisting(state: ReindexState, cwd: string, kb: { store: SqliteFtsStore; cfg: ResolvedConfig }): Promise<ReindexResult> {
  const { store, cfg } = kb;
  let changed = 0, chunks = 0;
  let failure: unknown;
  for (const s of cfg.resolvedSources) {
    try {
      const force = sourceGateIsStale(store, cfg, s.id);
      const st = await indexSource(store, { root: s.id, dir: s.dir }, indexOptionsFromConfig(cfg, { force, onFirstBatch: force ? beginForcedSource(store, s.id) : undefined }));
      if (!st.missing) stampSource(store, cfg, s.id);
      changed += st.changed; chunks += st.chunks;
    } catch (e) {
      failure ??= e;
    }
  }
  stampPass(store, cfg);
  if (failure !== undefined) throw failure;
  // Only after every source resolved, and only if the cwd was not closed
  // mid-pass (closeKbForCwd evicts the handle).
  if (state.kb.has(cwd)) state.completed.add(cwd);
  return { changed, chunks };
}

/** Install failures are the one first-index line worth a session warning. */
const warnInstallFailure = (line: string): void => {
  if (line.includes("install-failed")) console.warn(line);
};

/** Reindex filesystem sources now (called after debounce). Hash-gated via the
 *  indexer's mtime→sha256 incremental pass. */
export function reindexNow(state: ReindexState, cwd: string): Promise<{ changed: number; chunks: number }> {
  // Coalesce concurrent reindexes for one cwd onto a single in-flight walk
  // (they share a cached store; overlapping async walks would interleave the
  // batched transaction). See change: fix-kb-index-feedback.
  // Self-heal on cwd removal: if the worktree dir is gone (e.g. `git worktree
  // remove`), evict any cached handle and no-op instead of reopening — a fresh
  // store would recreate `<cwd>/.pi/dashboard/kb` and resurrect a husk. See
  // change: sweep-worktree-residual-on-remove.
  if (!existsSync(cwd)) {
    closeKbForCwd(state, cwd);
    return Promise.resolve({ changed: 0, chunks: 0 });
  }
  const existing = state.inflight.get(cwd);
  if (existing) return existing;
  const p = (async () => {
    const kb = getKb(state, cwd);
    return kb ? reindexExisting(state, cwd, kb) : buildFirstIndex(state, cwd);
  })().finally(() => {
    if (state.inflight.get(cwd) === p) state.inflight.delete(cwd);
  });
  // Attached at CREATION (not at abandon time): a pass whose every waiter gave
  // up would otherwise reject with no handler → unhandledRejection. This is the
  // single place a failed pass is logged. Waiters still observe the rejection
  // through their own await. See change: bound-kb-search-freshness.
  p.catch((e) => {
    const msg = (e as Error)?.message ?? String(e);
    // A concurrent writer (another dox-describe subagent) can hold the write
    // lock. Tolerate it: log + drop — a later scheduled reindex or the
    // parent's final reindex is authoritative (design D8).
    if (/SQLITE_BUSY|database is locked/i.test(msg)) console.warn(`[kb] reindex deferred (index busy): ${msg}`);
    else console.warn(`[kb] reindex failed: ${msg}`);
  });
  state.inflight.set(cwd, p);
  return p;
}

/** Bounded wait for index freshness. Races the SHARED in-flight pass against an
 *  unref'd timer and the caller's signal. Expiry / abort abandons the WAIT, never
 *  the work: the pass keeps running for the debounce path and later callers.
 *  - `start: "always"` (kb_search): join the in-flight pass, else start one.
 *  - `start: "if-empty"` (kb_get / kb_neighbors): join an in-flight pass (any chunk
 *    count — a mid-walk index is partial); else start one only when the index is
 *    empty; else `"done"` with no walk.
 *  Never throws. See change: bound-kb-search-freshness. */
export async function awaitFreshness(
  state: ReindexState,
  cwd: string,
  opts: { start: "always" | "if-empty"; budgetMs: number; signal?: AbortSignal },
): Promise<FreshnessOutcome> {
  const { start, budgetMs, signal } = opts;
  if (signal?.aborted) return "aborted";
  if (!existsSync(cwd)) {
    if (start === "always") await reindexNow(state, cwd).catch(() => undefined); // evicts the handle (removed-cwd no-op)
    return "done";
  }
  let pass: Promise<unknown> | undefined = state.inflight.get(cwd);
  if (!pass) {
    // Back off BEFORE any store work while another process builds the first index.
    if (foreignFirstIndexLive(state, cwd)) return "building";
    try {
      const kb = getKb(state, cwd);
      if (start === "always" || !kb || kb.store.counts().chunks === 0) pass = reindexNow(state, cwd);
    } catch (e) {
      console.warn(`[kb] freshness check failed, using existing index: ${(e as Error).message}`);
      return "failed";
    }
  }
  if (!pass) return "done";
  if (budgetMs <= 0) {
    pass.catch(() => undefined);
    return "timeout"; // never wait; the pass continues in the background
  }
  return new Promise<FreshnessOutcome>((resolve) => {
    let settled = false;
    const finish = (o: FreshnessOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); // every settle path, including the fast one: no leaked wakeup
      signal?.removeEventListener("abort", onAbort);
      resolve(o);
    };
    const timer = setTimeout(() => finish("timeout"), budgetMs);
    timer.unref?.();
    const onAbort = () => finish("aborted");
    signal?.addEventListener("abort", onAbort, { once: true });
    pass.then(() => finish("done"), () => finish("failed"));
  });
}

/** Cold-start guard for the pull tools. Builds the index once when it is empty
 *  so `kb_neighbors` / `kb_get` never return a false-empty result on a
 *  never-indexed cwd (they open a store via `getKb` but do not populate it,
 *  unlike `kb_search` which always runs a freshness `reindexNow`). On a warm
 *  index this is a single `COUNT(*)` and a no-op walk-wise. A removed cwd is a
 *  safe no-op. Throws propagate to the caller, which guards them (extension.ts),
 *  mirroring `kb_search`'s existing graceful fallback. See change:
 *  fix-kb-neighbors-get-cold-start. */
export async function ensurePopulated(state: ReindexState, cwd: string): Promise<void> {
  if (!existsSync(cwd)) return;
  // A pass in flight means the index may be partial whatever its chunk count
  // (batched commits): join it before the empty-index test.
  const running = state.inflight.get(cwd);
  if (running) {
    await running;
    return;
  }
  const kb = getKb(state, cwd);
  if (!kb) {
    if (!foreignFirstIndexLive(state, cwd)) await reindexNow(state, cwd);
    return;
  }
  if (kb.store.counts().chunks === 0) {
    await reindexNow(state, cwd);
  }
}

/** Schedule a debounced reindex for an edited .md path. */
export function scheduleReindex(state: ReindexState, cwd: string, _path: string, debounceMs = DEFAULT_DEBOUNCE_MS): void {
  const key = cwd;
  const existing = state.timers.get(key);
  if (existing) clearTimeout(existing);
  state.timers.set(key, setTimeout(() => {
    state.timers.delete(key);
    // Failure is logged once at pass creation (reindexNow); nothing to add here.
    reindexNow(state, cwd).catch(() => undefined);
  }, debounceMs));
}

/** Close + evict the cached store for a single cwd, cancelling its debounce
 *  timer. Used when a cwd is removed so a later tick cannot reopen it. Closing
 *  the last WAL connection checkpoints and drops the `-wal`/`-shm` sidecars, so
 *  no residue lingers. See change: sweep-worktree-residual-on-remove. */
export function closeKbForCwd(state: ReindexState, cwd: string): void {
  const entry = state.kb.get(cwd);
  if (entry) { try { entry.store.close(); } catch { /* */ } }
  state.kb.delete(cwd);
  state.completed.delete(cwd);
  const t = state.timers.get(cwd);
  if (t) { clearTimeout(t); state.timers.delete(cwd); }
}

/** Close any cached store (on session_shutdown). */
export function closeKb(state: ReindexState): void {
  for (const { store } of state.kb.values()) { try { store.close(); } catch { /* */ } }
  state.kb.clear();
  state.completed.clear();
  for (const t of state.timers.values()) clearTimeout(t);
  state.timers.clear();
}

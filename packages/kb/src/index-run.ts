// Atomic `kb index` orchestration. Failure-atomicity guarantee: a file at
// `dbPath` means a successful index ran. See changes: harden-kb-index-failure-atomicity,
// fix-kb-index-integrity.
//
// D1 (design.md): branch on whether `dbPath` already exists.
//   - First index (no dbPath): build into `<dbPath>.tmp-<pid>` and INSTALL it only on
//     success. A crash/OOM/SIGKILL leaves only the temp orphan — the real path never
//     appears, so the worktree-init gate correctly re-fires.
//     The install never clobbers: an atomic hard link claims `dbPath` when it is
//     absent; if another process created it meanwhile (a pull tool opened it, a
//     concurrent indexer won), the built contents are copied INTO it with SQLite's
//     online backup API, so every handle already open on `dbPath` sees them. A rename
//     would orphan such a holder's path-keyed -wal/-shm and silently empty the index.
//   - Incremental (valid dbPath exists): index in place, preserving the in-DB
//     file-state incremental skip needs. A mid-run failure leaves the prior DB
//     valid & queryable; a re-run completes it.
import { existsSync, linkSync, readdirSync, renameSync, statSync, unlinkSync, utimesSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import * as sqlite from "node:sqlite";
import type { IndexGateConfig } from "./config.js";
import { sourceGateIsStale, stampPass, stampSource } from "./index-gate.js";
import { type IndexOptions, type IndexStats, indexSource } from "./indexer.js";
import { SCHEMA_VERSION, SqliteFtsStore } from "./sqlite-store.js";

type StoreCounts = ReturnType<SqliteFtsStore["counts"]>;

/** The single line a pull tool / CLI prints while another process builds the first index. */
export const BUILDING_LINE = "(index is still being built — no results available yet; retry shortly)";

/** A temp build whose newest mtime is within this window of now is "live". */
const LIVE_BUILD_WINDOW_MS = 120_000;
/** Tolerated mtime-ahead-of-clock (timestamp rounding / small skew); beyond it the mtime is not trusted. */
const FUTURE_SKEW_MS = 2_000;
/** A temp this old is litter whatever its PID (a recycled PID must not pin it forever). */
const ORPHAN_AGE_MS = 60 * 60_000;
/** Builder refreshes its temp's mtime this often (a timer cannot fire inside a synchronous batch). */
const HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_INSTALL_MAX_WAIT_MS = 30_000;

export interface AtomicIndexSource {
  id: string;
  dir: string;
}
export interface RunIndexAtomicOpts {
  dbPath: string;
  sources: AtomicIndexSource[];
  indexOpts?: IndexOptions;
  /** Sources came from an explicit `--source` arg; a missing one is a user typo. */
  explicit?: boolean;
  /** When set, participates in the schema-version reindex gate (design D6): a
   *  changed facet-config hash forces a one-time full reindex. Legacy global gate. */
  facetConfigHash?: string;
  /** Per-source schema-version / options-hash gate (design D6): force exactly the
   *  sources whose `gate:<root>` record is absent or stale; stamp each source after
   *  a completed walk. Also supplies the back-compat `facetConfigHash` stamp. */
  gate?: IndexGateConfig;
  /** Install log sink (default: stderr). */
  log?: (line: string) => void;
  /** Test seams. */
  install?: Partial<InstallDeps>;
  heartbeat?: HeartbeatDeps;
}

/** True if `pid` names a live process (existence probe via signal 0). EPERM =
 *  alive but not ours; ESRCH = dead. kb is self-contained (no pi-dashboard-shared
 *  dep, same as `sources.ts`), so it probes with a raw signal-0 send rather than
 *  the shared platform helper — signal 0 is a read-only liveness check, never a
 *  termination (see the ban-opt-out marker below). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // ban:process-kill-ok kb self-contained; signal 0 = liveness probe only
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

interface TempBuild {
  pid: number;
  /** every `<base>.tmp-<pid>[-wal|-shm]` entry of this build */
  files: string[];
  /** newest mtime of the temp file or its `-wal` (the heartbeat/commit signals) */
  mtimeMs: number;
}

/** Group the `<dbPath>.tmp-<pid>` entries (+ WAL sidecars) next to `dbPath` by PID. */
function listTempBuilds(dbPath: string): TempBuild[] {
  const dir = dirname(dbPath);
  const prefix = `${basename(dbPath)}.tmp-`;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const byPid = new Map<number, TempBuild>();
  for (const e of entries) {
    if (!e.startsWith(prefix)) continue;
    // filename is `<base>.tmp-<pid>` or a `-wal`/`-shm` sidecar of it.
    const rest = e.slice(prefix.length);
    const pid = Number(rest.split(/[.-]/)[0]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const abs = join(dir, e);
    const b = byPid.get(pid) ?? { pid, files: [], mtimeMs: 0 };
    b.files.push(abs);
    if (!e.endsWith("-shm")) {
      try {
        b.mtimeMs = Math.max(b.mtimeMs, statSync(abs).mtimeMs);
      } catch {}
    }
    byPid.set(pid, b);
  }
  return [...byPid.values()];
}

/** Live-build marker: another process is building the first index ⇔ a
 *  `<dbPath>.tmp-<pid>` exists whose PID is alive (and not ours) and whose newest
 *  mtime (temp file or `-wal`) is within 120 s of now (a few seconds of
 *  clock skew ahead are tolerated; a mtime further in the future is not trusted, so not live). Callers consult it ONLY while `dbPath` is absent.
 *  See change: fix-kb-index-integrity (D2). */
export function isFirstIndexLive(dbPath: string, opts: { now?: () => number } = {}): boolean {
  const now = (opts.now ?? Date.now)();
  for (const b of listTempBuilds(dbPath)) {
    if (b.pid === process.pid) continue;
    const age = now - b.mtimeMs;
    if (age < -FUTURE_SKEW_MS || age > LIVE_BUILD_WINDOW_MS) continue;
    if (isProcessAlive(b.pid)) return true;
  }
  return false;
}

/** Remove stale `<dbPath>.tmp-*` orphans (+ WAL sidecars) left by a prior
 *  SIGKILL'd first-index run, so temp husks do not accumulate. A temp whose PID
 *  names a LIVE process belongs to a concurrent peer run and is left alone —
 *  unlinking it would break that peer's install — unless its newest mtime is over
 *  an hour old (a recycled PID on abandoned litter; a live build refreshes every
 *  30 s so is never that old). */
export function sweepOrphanTemps(dbPath: string, opts: { now?: () => number } = {}): void {
  const now = (opts.now ?? Date.now)();
  for (const b of listTempBuilds(dbPath)) {
    const alive = b.pid === process.pid || isProcessAlive(b.pid);
    const abandoned = b.pid !== process.pid && now - b.mtimeMs > ORPHAN_AGE_MS;
    if (alive && !abandoned) continue;
    for (const f of b.files) {
      try {
        unlinkSync(f);
      } catch {}
    }
  }
}

export interface HeartbeatDeps {
  now?: () => number;
  utimes?: (path: string, atime: Date, mtime: Date) => void;
  intervalMs?: number;
}
/** Per-file heartbeat for the first-index builder: refreshes the temp file's mtime
 *  at most every `intervalMs` (checked from the walk loop, not a timer). */
export function makeHeartbeat(tmpPath: string, deps: HeartbeatDeps = {}): () => void {
  const now = deps.now ?? Date.now;
  const utimes = deps.utimes ?? utimesSync;
  const interval = deps.intervalMs ?? HEARTBEAT_INTERVAL_MS;
  let last = now();
  return () => {
    const n = now();
    if (n - last < interval) return;
    last = n;
    try {
      utimes(tmpPath, new Date(n), new Date(n));
    } catch {}
  };
}

export interface InstallDeps {
  linkSync: (existing: string, target: string) => void;
  renameSync: (from: string, to: string) => void;
  existsSync: (p: string) => boolean;
  backup: (src: sqlite.DatabaseSync, path: string, opts?: { rate?: number }) => Promise<number>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  maxWaitMs: number;
  log: (line: string) => void;
}
export interface InstallResult {
  branch: "link" | "rename" | "backup";
  retries: number;
  ms: number;
}

const BACKUP_RETRY_CODES = new Set([0, 5, 6]); // SQLITE_OK-ish "not an error" (observed), BUSY, LOCKED

function removeTemp(tmp: string): void {
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(tmp + ext);
    } catch {}
  }
}

/** Link-then-rename leg of the install: `"link"`/`"rename"` when it installed, `null` when
 *  `dbPath` exists (EEXIST, or another link failure with `dbPath` present) and the caller must
 *  copy into it instead. */
function installByLinkOrRename(tmp: string, dbPath: string, d: InstallDeps): "link" | "rename" | null {
  try {
    d.linkSync(tmp, dbPath);
    removeTemp(tmp);
    return "link";
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "EEXIST" || d.existsSync(dbPath)) return null;
    // filesystem without hard links, dbPath still absent: a rename (a sub-millisecond
    // check-then-rename race remains on those filesystems only)
    d.renameSync(tmp, dbPath);
    removeTemp(tmp);
    return "rename";
  }
}

/** Copy the built temp database INTO the existing `dbPath` with SQLite's online backup so every
 *  handle already open on it sees the contents. One backup step (destination changes in a single
 *  write transaction); busy/locked retried with backoff up to `maxWaitMs`. Returns the retry
 *  count; throws after logging on a non-retriable error or the bound elapsing. */
async function installByBackup(tmp: string, dbPath: string, d: InstallDeps, t0: number): Promise<number> {
  const src = new sqlite.DatabaseSync(tmp);
  let retries = 0;
  let delay = 100;
  const fail = (reason: string): never => {
    try {
      src.close();
    } catch {}
    removeTemp(tmp);
    d.log(`[kb] install-failed=${reason} retries=${retries} ms=${Math.max(0, Math.round(d.now() - t0))}`);
    throw new Error(`kb index: could not install the built index at ${dbPath} (${reason}); the existing database was left in place`);
  };
  const pages = Math.max(1, Number((src.prepare("PRAGMA page_count").get() as { page_count: number }).page_count));
  for (;;) {
    try {
      await d.backup(src, dbPath, { rate: pages });
      src.close();
      removeTemp(tmp);
      return retries;
    } catch (err) {
      const errcode = (err as { errcode?: unknown })?.errcode;
      if (typeof errcode !== "number" || !BACKUP_RETRY_CODES.has(errcode)) return fail(`backup-error:${typeof errcode === "number" ? errcode : "unknown"}`);
      if (d.now() - t0 + delay > d.maxWaitMs) return fail("busy-timeout");
      await d.sleep(delay);
      retries++;
      delay = Math.min(delay * 2, 2000);
    }
  }
}

/** Install the finished temp build at `dbPath` without ever clobbering it.
 *  link → rename (no-hard-link filesystems, `dbPath` absent) → backup into the
 *  existing file with a bounded busy-retry. Never removes a file it did not create.
 *  See change: fix-kb-index-integrity (D1). */
export async function installIndex(tmp: string, dbPath: string, overrides: Partial<InstallDeps> = {}): Promise<InstallResult> {
  const d: InstallDeps = {
    linkSync,
    renameSync,
    existsSync,
    backup: (src, path, o) => sqlite.backup(src, path, o),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
    maxWaitMs: Number(process.env.KB_INSTALL_MAX_WAIT_MS) > 0 ? Number(process.env.KB_INSTALL_MAX_WAIT_MS) : DEFAULT_INSTALL_MAX_WAIT_MS,
    log: (l) => process.stderr.write(`${l}\n`),
    ...(Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) as Partial<InstallDeps>),
  };
  const t0 = d.now();
  const done = (branch: InstallResult["branch"], retries: number): InstallResult => {
    const ms = Math.max(0, Math.round(d.now() - t0));
    d.log(`[kb] install=${branch} retries=${retries} ms=${ms}`);
    return { branch, retries, ms };
  };
  const quick = installByLinkOrRename(tmp, dbPath, d);
  if (quick) return done(quick, 0);
  return done("backup", await installByBackup(tmp, dbPath, d, t0));
}

/** Hard errors before any store opens (no husk possible): an explicit `--source` dir that does not
 *  exist is a typo (D3); every configured dir absent means nothing is indexable. */
function assertIndexable(sources: AtomicIndexSource[], explicit?: boolean): void {
  if (explicit) {
    for (const s of sources) {
      if (!existsSync(s.dir)) throw new Error(`kb index: --source directory does not exist: ${s.dir}`);
    }
  }
  if (!sources.some((s) => existsSync(s.dir))) {
    throw new Error("kb index: no configured source directory exists");
  }
}

/** Legacy global gate (callers without `gate`): a stale schema version or a changed
 *  facet-config hash forces a one-time full reindex so new structures populate. */
function legacyGateStale(store: SqliteFtsStore, facetConfigHash: string | undefined): boolean {
  const ver = store.getUserVersion?.() ?? 0;
  const storedHash = store.getMeta?.("facetConfigHash") ?? null;
  return ver < SCHEMA_VERSION || (facetConfigHash != null && storedHash !== facetConfigHash);
}

export async function runIndexAtomic(opts: RunIndexAtomicOpts): Promise<IndexStats & { counts: StoreCounts }> {
  const { dbPath, sources, indexOpts } = opts;
  assertIndexable(sources, opts.explicit);

  sweepOrphanTemps(dbPath);
  const preexisting = existsSync(dbPath);
  const target = preexisting ? dbPath : `${dbPath}.tmp-${process.pid}`;

  const store = new SqliteFtsStore(target);
  store.init();
  const legacyStale = preexisting && !opts.gate && legacyGateStale(store, opts.facetConfigHash);
  const heartbeat = preexisting ? undefined : makeHeartbeat(target, opts.heartbeat);
  let ok = false;
  try {
    const total: IndexStats = { scanned: 0, changed: 0, deleted: 0, chunks: 0, parseFailures: 0 };
    for (const s of sources) {
      const force = !!indexOpts?.force || legacyStale || (!!opts.gate && preexisting && sourceGateIsStale(store, opts.gate, s.id));
      const st = await indexSource(store, { root: s.id, dir: s.dir }, { ...indexOpts, force, heartbeat });
      // A skipped (missing) source is not stamped, so it stays due.
      if (opts.gate && !st.missing) stampSource(store, opts.gate, s.id);
      total.scanned += st.scanned;
      total.changed += st.changed;
      total.deleted += st.deleted;
      total.chunks += st.chunks;
      total.parseFailures = (total.parseFailures ?? 0) + (st.parseFailures ?? 0);
    }
    // Read counts from the still-open store so callers never need a second
    // openStore() connection just to report them (keeps `index` off openStore).
    const counts = store.counts();
    // Stamp the schema version + facet-config hash so the gate is satisfied next open.
    stampAfterPass(store, opts);
    if (preexisting) store.close();
    else {
      store.checkpointAndClose();
      await installIndex(target, dbPath, { log: opts.log, ...opts.install });
    }
    ok = true;
    return { ...total, counts };
  } finally {
    if (!ok) discardFailedRun(store, preexisting);
  }
}

function stampAfterPass(store: SqliteFtsStore, opts: RunIndexAtomicOpts): void {
  if (opts.gate) stampPass(store, opts.gate);
  else {
    store.setUserVersion?.(SCHEMA_VERSION);
    if (opts.facetConfigHash != null) store.setMeta?.("facetConfigHash", opts.facetConfigHash);
  }
}

/** Only a run that CREATED the file cleans it up (the temp — never `dbPath`, which may now be
 *  another writer's database); an existing valid DB is left in place (valid & queryable). */
function discardFailedRun(store: SqliteFtsStore, preexisting: boolean): void {
  if (preexisting) {
    try {
      store.close();
    } catch {}
  } else {
    store.closeAndUnlink();
  }
}

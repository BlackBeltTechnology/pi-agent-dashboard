// Atomic `kb index` orchestration. Failure-atomicity guarantee: a file at
// `dbPath` means a successful index ran. See change: harden-kb-index-failure-atomicity.
//
// D1 (design.md): branch on whether `dbPath` already exists.
//   - First index (no dbPath): build into `<dbPath>.tmp-<pid>` and rename() onto
//     dbPath only on success. A crash/OOM/SIGKILL leaves only the temp orphan —
//     the real path never appears, so the worktree-init gate correctly re-fires.
//     A create-track → close()+unlink()-on-failure variant is NOT used: that
//     cleanup is dead code under uncatchable termination and would leave the husk.
//   - Incremental (valid dbPath exists): index in place, preserving the in-DB
//     file-state incremental skip needs. A mid-run failure leaves the prior DB
//     valid & queryable; a re-run completes it.
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type IndexOptions, type IndexStats, indexSource } from "./indexer.js";
import { SqliteFtsStore } from "./sqlite-store.js";

type StoreCounts = ReturnType<SqliteFtsStore["counts"]>;

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

/** Remove stale `<dbPath>.tmp-*` orphans (+ WAL sidecars) left by a prior
 *  SIGKILL'd first-index run, so temp husks do not accumulate. A temp file whose
 *  PID names a LIVE process belongs to a concurrent peer run and is left alone —
 *  unlinking it would break that peer's finalize `rename`. */
export function sweepOrphanTemps(dbPath: string): void {
  const dir = dirname(dbPath);
  const prefix = `${basename(dbPath)}.tmp-`;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.startsWith(prefix)) continue;
    // filename is `<base>.tmp-<pid>` or a `-wal`/`-shm` sidecar of it.
    const pid = Number(e.slice(prefix.length).split(/[.-]/)[0]);
    if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) continue; // live peer
    {
      try {
        unlinkSync(join(dir, e));
      } catch {}
    }
  }
}

export async function runIndexAtomic(opts: RunIndexAtomicOpts): Promise<IndexStats & { counts: StoreCounts }> {
  const { dbPath, sources, indexOpts, explicit } = opts;

  // D3: an explicit --source dir that does not exist is a typo → hard error,
  // before any store is opened (no husk possible).
  if (explicit) {
    for (const s of sources) {
      if (!existsSync(s.dir)) throw new Error(`kb index: --source directory does not exist: ${s.dir}`);
    }
  }

  // Every configured source dir absent → nothing indexable. Checked BEFORE any
  // store is opened so a first index never creates a temp husk in this case.
  if (!sources.some((s) => existsSync(s.dir))) {
    throw new Error("kb index: no configured source directory exists");
  }

  sweepOrphanTemps(dbPath);
  const preexisting = existsSync(dbPath);
  const target = preexisting ? dbPath : `${dbPath}.tmp-${process.pid}`;

  const store = new SqliteFtsStore(target);
  store.init();
  let ok = false;
  try {
    const total: IndexStats = { scanned: 0, changed: 0, deleted: 0, chunks: 0 };
    for (const s of sources) {
      const st = await indexSource(store, { root: s.id, dir: s.dir }, indexOpts ?? {});
      total.scanned += st.scanned;
      total.changed += st.changed;
      total.deleted += st.deleted;
      total.chunks += st.chunks;
    }
    // Read counts from the still-open store so callers never need a second
    // openStore() connection just to report them (keeps `index` off openStore).
    const counts = store.counts();
    if (preexisting) store.close();
    else store.finalizeRename(dbPath);
    ok = true;
    return { ...total, counts };
  } finally {
    if (!ok) {
      // Only a run that CREATED the file cleans it up; an existing valid DB is
      // left in place (valid & queryable).
      if (preexisting) {
        try {
          store.close();
        } catch {}
      } else {
        store.closeAndUnlink();
      }
    }
  }
}

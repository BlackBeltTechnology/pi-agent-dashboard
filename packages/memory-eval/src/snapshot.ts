/**
 * Stat-stable file-copy snapshots (design M4). A source database is NEVER
 * opened: the file and its `-wal` are copied (never `-shm`), the copy is
 * integrity-checked, `VACUUM INTO` folds the WAL frames into a fresh snapshot,
 * and the snapshot is switched to `journal_mode=DELETE`.
 */
import { closeSync, copyFileSync, mkdirSync, openSync, readSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CliError } from "./util.js";

const MAX_SNAPSHOT_ATTEMPTS = 5;

interface FileStat {
  size: number;
  mtimeMs: number;
  /** WAL header salt (hex), `""` for a non-WAL file. */
  salt: string;
}

interface StatInfo {
  attempt: number;
  phase: "before" | "after";
}

export interface SnapshotDeps {
  statFile(path: string, info: StatInfo): FileStat | null;
  copyFile(src: string, dst: string, attempt: number): void;
}

function walSalt(path: string): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(8);
    const n = readSync(fd, buf, 0, 8, 16);
    return n === 8 ? buf.toString("hex") : "";
  } finally {
    closeSync(fd);
  }
}

const realSnapshotDeps: SnapshotDeps = {
  statFile(path) {
    try {
      const st = statSync(path);
      return { size: st.size, mtimeMs: st.mtimeMs, salt: path.endsWith("-wal") && st.size >= 24 ? walSalt(path) : "" };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; // only a genuinely missing file is "absent"
      throw e;
    }
  },
  copyFile(src, dst) {
    copyFileSync(src, dst);
  },
};

const sig = (s: FileStat | null) => (s ? `${s.size}:${s.mtimeMs}:${s.salt}` : "absent");

export type SnapshotResult =
  | { status: "absent"; source: string }
  | { status: "ok"; source: string; path: string; attempts: number; fingerprint: Record<string, unknown> };

export interface SnapshotOpts {
  /** Source DB path (never opened). */
  source: string;
  /** Directory the final snapshot and the transient `raw/` live in. */
  destDir: string;
  /** Snapshot file name, e.g. `hermes.db`. */
  name: string;
  fingerprint: (db: DatabaseSync) => Record<string, unknown>;
  /** Tables the evaluation reads; a source missing any of them is not that database. */
  requiredTables: string[];
  deps?: Partial<SnapshotDeps>;
}

function integrityOk(path: string): boolean {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path);
    const rows = db.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>;
    return rows.length === 1 && Object.values(rows[0])[0] === "ok";
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

/** One attempt: copy, stat again, integrity-check. Returns the raw copy's path, or the reason it failed. */
function attemptCopy(deps: SnapshotDeps, opts: SnapshotOpts, rawDb: string, attempt: number): { ok: true } | { ok: false; reason: string } {
  const walSrc = `${opts.source}-wal`;
  const before = [deps.statFile(opts.source, { attempt, phase: "before" }), deps.statFile(walSrc, { attempt, phase: "before" })];
  try {
    deps.copyFile(opts.source, rawDb, attempt);
    if (before[1]) deps.copyFile(walSrc, `${rawDb}-wal`, attempt);
  } catch (e) {
    return { ok: false, reason: `copy failed (${e instanceof Error ? e.message : String(e)})` }; // e.g. the WAL vanished mid-copy
  }
  const after = [deps.statFile(opts.source, { attempt, phase: "after" }), deps.statFile(walSrc, { attempt, phase: "after" })];
  if (sig(before[0]) !== sig(after[0]) || sig(before[1]) !== sig(after[1])) return { ok: false, reason: "a writer raced the copy" };
  return integrityOk(rawDb) ? { ok: true } : { ok: false, reason: "integrity_check failed on the copy" };
}

function vacuumInto(rawDb: string, out: string, fingerprint: SnapshotOpts["fingerprint"]): Record<string, unknown> {
  rmSync(out, { force: true });
  const raw = new DatabaseSync(rawDb);
  try {
    raw.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  } finally {
    raw.close();
  }
  const snap = new DatabaseSync(out);
  try {
    snap.exec("PRAGMA journal_mode=DELETE");
    return fingerprint(snap);
  } finally {
    snap.close();
  }
}

/** Names from `requiredTables` that the copy lacks (virtual tables included). */
function missingTables(rawDb: string, required: string[]): string[] {
  const db = new DatabaseSync(rawDb);
  try {
    const have = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name));
    return required.filter((t) => !have.has(t));
  } finally {
    db.close();
  }
}

export function snapshotDb(opts: SnapshotOpts): SnapshotResult {
  const deps: SnapshotDeps = { ...realSnapshotDeps, ...opts.deps };
  const probe = deps.statFile(opts.source, { attempt: 0, phase: "before" });
  if (!probe) return { status: "absent", source: opts.source };
  // An existing zero-byte file is a damaged or half-created database, not a missing one: silently
  // evaluating it would produce a "completed" run full of missing-table errors.
  if (probe.size === 0) throw new CliError(`snapshot source ${opts.source} exists but is empty (0 bytes); refusing to evaluate it`);
  const rawDir = join(opts.destDir, "raw");
  const rawDb = join(rawDir, opts.name);
  const out = join(opts.destDir, opts.name);
  let lastReason = "";
  try {
    for (let attempt = 1; attempt <= MAX_SNAPSHOT_ATTEMPTS; attempt++) {
      rmSync(rawDir, { recursive: true, force: true });
      mkdirSync(rawDir, { recursive: true, mode: 0o700 });
      const r = attemptCopy(deps, opts, rawDb, attempt);
      if (!r.ok) {
        lastReason = r.reason;
        continue;
      }
      const missing = missingTables(rawDb, opts.requiredTables);
      if (missing.length) throw new CliError(`snapshot source ${opts.source} is not the expected database: missing table(s) ${missing.join(", ")}`);
      return { status: "ok", source: opts.source, path: out, attempts: attempt, fingerprint: vacuumInto(rawDb, out, opts.fingerprint) };
    }
  } finally {
    rmSync(rawDir, { recursive: true, force: true }); // the transient copy never outlives the call
  }
  throw new CliError(`snapshot of ${opts.source} failed after ${MAX_SNAPSHOT_ATTEMPTS} attempts (last: ${lastReason})`);
}

/** Row counts + max timestamps of the hermes tables, as a logical fingerprint. */
export function hermesFingerprint(db: DatabaseSync): Record<string, unknown> {
  const one = (sql: string) => {
    try {
      return Object.values((db.prepare(sql).get() ?? {}) as Record<string, unknown>)[0] ?? "absent";
    } catch {
      return "absent";
    }
  };
  return {
    sessions: one("SELECT COUNT(*) FROM sessions"),
    messages: one("SELECT COUNT(*) FROM messages"),
    memories: one("SELECT COUNT(*) FROM memories"),
    maxMessageTimestamp: one("SELECT MAX(timestamp) FROM messages"),
    maxMemoryCreated: one("SELECT MAX(created) FROM memories"),
  };
}

export function kbFingerprint(db: DatabaseSync): Record<string, unknown> {
  const one = (sql: string) => {
    try {
      return Object.values((db.prepare(sql).get() ?? {}) as Record<string, unknown>)[0] ?? "absent";
    } catch {
      return "absent";
    }
  };
  return { chunks: one("SELECT COUNT(*) FROM chunks"), files: one("SELECT COUNT(*) FROM files") };
}

export const HERMES_TABLES = ["sessions", "messages", "message_fts", "memories", "memory_fts"];
export const KB_TABLES = ["chunks", "files"];

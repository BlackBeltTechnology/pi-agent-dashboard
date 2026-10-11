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
    } catch {
      return null;
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

export function snapshotDb(opts: SnapshotOpts): SnapshotResult {
  const deps: SnapshotDeps = { ...realSnapshotDeps, ...opts.deps };
  const probe = deps.statFile(opts.source, { attempt: 0, phase: "before" });
  if (!probe || probe.size === 0) return { status: "absent", source: opts.source };
  const walSrc = `${opts.source}-wal`;
  const rawDir = join(opts.destDir, "raw");
  const rawDb = join(rawDir, opts.name);
  const out = join(opts.destDir, opts.name);
  for (let attempt = 1; attempt <= MAX_SNAPSHOT_ATTEMPTS; attempt++) {
    rmSync(rawDir, { recursive: true, force: true });
    mkdirSync(rawDir, { recursive: true, mode: 0o700 });
    const before = [deps.statFile(opts.source, { attempt, phase: "before" }), deps.statFile(walSrc, { attempt, phase: "before" })];
    deps.copyFile(opts.source, rawDb, attempt);
    if (before[1]) deps.copyFile(walSrc, `${rawDb}-wal`, attempt);
    const after = [deps.statFile(opts.source, { attempt, phase: "after" }), deps.statFile(walSrc, { attempt, phase: "after" })];
    if (sig(before[0]) !== sig(after[0]) || sig(before[1]) !== sig(after[1])) continue; // a writer raced the copy
    if (!integrityOk(rawDb)) continue;
    rmSync(out, { force: true });
    const db = new DatabaseSync(rawDb);
    try {
      db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
    const snap = new DatabaseSync(out);
    try {
      snap.exec("PRAGMA journal_mode=DELETE");
      const fingerprint = opts.fingerprint(snap);
      snap.close();
      rmSync(rawDir, { recursive: true, force: true });
      return { status: "ok", source: opts.source, path: out, attempts: attempt, fingerprint };
    } catch (e) {
      snap.close();
      throw e;
    }
  }
  rmSync(rawDir, { recursive: true, force: true });
  throw new CliError(`snapshot of ${opts.source} failed after ${MAX_SNAPSHOT_ATTEMPTS} attempts (source kept changing or the copy failed its integrity check)`);
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

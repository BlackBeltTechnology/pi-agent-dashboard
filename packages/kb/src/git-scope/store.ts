// Per-repository git-scope database: the kb schema plus three git tables
// (design G1). State and data share one SQLite file so a cursor can never
// desync from the items it covers.
import { SqliteFtsStore } from "../sqlite-store.js";
import type { KbStore, RawDb } from "../types.js";
import { ensureRepoDir, type ResolvedRepo } from "./repo.js";

/** `root` of every git-scope chunk. */
export const GIT_ROOT = "git";

const GIT_DDL = `
CREATE TABLE IF NOT EXISTS git_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS git_lease (id INTEGER PRIMARY KEY CHECK (id = 1), owner TEXT, nonce TEXT, expires_at INTEGER);
INSERT OR IGNORE INTO git_lease (id, owner, nonce, expires_at) VALUES (1, '', '', 0);
CREATE TABLE IF NOT EXISTS git_comments (kind TEXT, n INTEGER, json TEXT, etag TEXT, fetched_at INTEGER, PRIMARY KEY (kind, n));
`;

const isBusy = (e: unknown): boolean => /locked|busy/i.test((e as Error)?.message ?? "");
const sleepSync = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The capabilities the git scope needs from a store (design G1). */
export function hasGitSupport(store: KbStore): boolean {
  return typeof store.immediate === "function" && typeof store.replaceItem === "function" && typeof store.ensureNode === "function" && typeof store.findPathsByPrefix === "function" && typeof store.read === "function";
}

/** Open (creating when needed) the repo's database. Two processes opening a
 *  fresh database at once may briefly hit SQLITE_BUSY while one switches WAL
 *  mode / creates the schema; retry a few times. */
export function openGitStore(repo: ResolvedRepo, baseDir: string, busyMs: number): SqliteFtsStore {
  ensureRepoDir(repo, baseDir);
  let last: unknown;
  for (let attempt = 0; attempt < 12; attempt++) {
    let store: SqliteFtsStore | null = null;
    try {
      store = new SqliteFtsStore(repo.dbPath, { busyTimeoutMs: 2000 });
      store.init();
      store.immediate((db) => db.exec(GIT_DDL));
      store.setBusyTimeout(busyMs);
      return store;
    } catch (e) {
      last = e;
      try {
        store?.close();
      } catch { /* already closed */ }
      if (!isBusy(e)) throw e;
      sleepSync(40 + attempt * 20);
    }
  }
  throw last;
}

export function metaGet(db: RawDb, key: string): string | null {
  const r = db.prepare("SELECT value FROM git_meta WHERE key=?").get(key) as { value: string } | undefined;
  return r ? r.value : null;
}
export function metaSet(db: RawDb, key: string, value: string): void {
  db.prepare("INSERT INTO git_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}
export function metaDelete(db: RawDb, key: string): void {
  db.prepare("DELETE FROM git_meta WHERE key=?").run(key);
}
export function metaJson<T>(db: RawDb, key: string): T | null {
  const v = metaGet(db, key);
  if (v == null) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}
export function metaSetJson(db: RawDb, key: string, value: unknown): void {
  metaSet(db, key, JSON.stringify(value));
}

// Per-cwd "is this file indexed by the kb?" predicate for the search guard's
// markdown-read detection. Built from the cwd's store (filesystem roots only —
// they are the files a shell `cat` can reach) and rebuilt when the index
// changes. The guard stays pure: it only receives the predicate.
// See change: fix-kb-get-roots-and-guard (design D5).

import { resolve } from "node:path";

interface PathStore {
  listRoots(): string[];
  listPaths(root: string): string[];
  read?<T>(fn: (db: { prepare(sql: string): { get(...args: unknown[]): unknown } }) => T): T;
}

interface Entry {
  store: PathStore;
  sig: string;
  paths: Set<string>;
}

const cache = new Map<string, Entry>();

/** Cheap index-generation signature: chunk count + highest chunk rowid. */
function signature(store: PathStore): string {
  if (!store.read) return "";
  return store.read((db) => {
    const r = db.prepare("SELECT COUNT(*) n, IFNULL(MAX(rowid), 0) m FROM chunks").get() as { n: number; m: number };
    return `${r.n}:${r.m}`;
  });
}

/** Predicate over shell args (resolved against `cwd`). Throws propagate to the
 *  guard, which treats them as "not indexed". */
export function indexedPathPredicate(cwd: string, store: PathStore, sources: Array<{ id: string; dir: string }>): (arg: string) => boolean {
  return (arg: string) => {
    const sig = signature(store);
    let e = cache.get(cwd);
    if (!e || e.store !== store || e.sig !== sig) {
      const roots = new Set(store.listRoots());
      const paths = new Set<string>();
      for (const s of sources) {
        if (!roots.has(s.id)) continue;
        for (const p of store.listPaths(s.id)) paths.add(resolve(s.dir, p));
      }
      e = { store, sig, paths };
      cache.set(cwd, e);
    }
    return e.paths.has(resolve(cwd, arg));
  };
}

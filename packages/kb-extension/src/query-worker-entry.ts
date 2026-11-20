// Op dispatcher of the kb query worker (change: bound-kb-proximity-search,
// design D6). Loaded by `query-worker.mjs` inside a worker thread; runs the
// synchronous docs retrieval (`store.search`, the `kb_get` fetch chain) so the
// session thread never blocks on it. Same exported kb functions and the same
// structured-cloned inputs as the in-process path in `extension.ts`.
import { buildFetchRoots, renderFetch, resolveFetch, type SearchOpts, SqliteFtsStore } from "@blackbelt-technology/pi-dashboard-kb";

export type SearchRequest = { op: "search"; dbPath: string; query: string; opts: SearchOpts };
export type FetchRequest = {
  op: "fetch";
  dbPath: string;
  arg: string;
  section?: string;
  hint: string;
  fsSources: Array<{ id: string; dir: string }>;
  cwd: string;
};
export type QueryRequest = SearchRequest | FetchRequest;

/** One read connection per database, opened once (SELECTs only). */
const stores = new Map<string, SqliteFtsStore>();
let empty: SqliteFtsStore | null = null;

/** The cached handle, or an empty in-memory store when the database vanished
 *  between the session's existence check and this open (not cached, not an error). */
function storeFor(dbPath: string): SqliteFtsStore {
  const hit = stores.get(dbPath);
  if (hit) return hit;
  const opened = SqliteFtsStore.openExisting(dbPath);
  if (opened) {
    stores.set(dbPath, opened);
    return opened;
  }
  if (!empty) {
    empty = new SqliteFtsStore(":memory:");
    empty.init();
  }
  return empty;
}

/** The retrieval itself, shared verbatim by the worker and the in-process fallback. */
export function runQuery(store: SqliteFtsStore, req: QueryRequest): unknown {
  if (req.op === "search") return store.search(req.query, req.opts);
  const roots = buildFetchRoots(store.listRoots(), req.fsSources, req.cwd);
  return renderFetch(resolveFetch(store, roots, req.arg, req.section), req.arg, req.section, req.hint);
}

export function handle(req: QueryRequest): unknown {
  if (req.op !== "search" && req.op !== "fetch") throw new Error(`kb query worker: unknown op ${(req as { op?: unknown }).op}`);
  return runQuery(storeFor(req.dbPath), req);
}

/** Release one database's connection (worktree removal). Unknown path → no-op. */
export function close(dbPath: string): void {
  const s = stores.get(dbPath);
  if (!s) return;
  stores.delete(dbPath);
  try { s.close(); } catch { /* already closed */ }
}

/** Old-stack adapters (design M4): hermes session/memory replicas and kb docs. */
import { DatabaseSync } from "node:sqlite";
import { loadConfig, SqliteFtsStore, searchOptsFromConfig } from "@blackbelt-technology/pi-dashboard-kb";
import type { Retriever, SearchQuery } from "../retriever.js";
import { searchMemoriesReplica, searchSessionsReplica } from "./hermes-session-search.js";

export const BUILTIN_IDS = ["hermes.session_search.recent", "hermes.session_search.bm25", "hermes.memory_search", "kb.docs"] as const;

/** Bumped when a replica's behaviour changes (golden regenerated). */
const REPLICA_VERSION = "1";

export function hermesRetrievers(dbPath: string): Retriever[] {
  let db: DatabaseSync | null = null;
  const open = () => (db ??= new DatabaseSync(dbPath, { readOnly: true }));
  const sessions = (order: "recent" | "bm25") => async (q: SearchQuery) => {
    const { rows, underFill } = searchSessionsReplica(open(), q.query, { project: q.project, asOf: q.asOf, excludeSessionId: q.excludeSessionId, limit: 10 }, order);
    return { hits: rows.map((r) => ({ ref: r.id, text: r.content, sessionId: r.session_id, timestamp: r.timestamp })), underFill };
  };
  return [
    { id: "hermes.session_search.recent", version: REPLICA_VERSION, asOf: "strict", sessionBacked: true, search: sessions("recent") },
    { id: "hermes.session_search.bm25", version: REPLICA_VERSION, asOf: "strict", sessionBacked: true, search: sessions("bm25") },
    {
      id: "hermes.memory_search",
      version: REPLICA_VERSION,
      asOf: "strict",
      async search(q) {
        return searchMemoriesReplica(open(), q.query, { project: q.project, asOf: q.asOf, limit: 10 }).map((m) => ({
          ref: `memory:${m.id}`,
          text: m.content,
          timestamp: `${m.created}T00:00:00Z`,
        }));
      },
    },
  ];
}

/** kb search over the snapshot with shipped defaults. Chunks carry no timestamp: asOf "none". */
export function kbRetriever(snapshotPath: string, cwd: string): Retriever {
  let store: SqliteFtsStore | null | undefined;
  return {
    id: "kb.docs",
    version: REPLICA_VERSION,
    asOf: "none",
    async search(q) {
      if (store === undefined) store = SqliteFtsStore.openExisting(snapshotPath);
      if (!store) return [];
      const cfg = loadConfig(cwd);
      const hits = store.search(q.query, { ...searchOptsFromConfig(cfg), limit: 10 });
      return hits.map((h) => ({ ref: `${h.path}#${h.headingPath}`, text: h.snippet }));
    },
  };
}

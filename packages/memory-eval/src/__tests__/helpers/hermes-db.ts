/** Synthetic hermes `sessions.db` builder (schema copied from pi-hermes-memory 0.9.10 `store/schema.ts`). */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const HERMES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS extension_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, project TEXT NOT NULL, cwd TEXT NOT NULL, started_at TEXT NOT NULL,
    ended_at TEXT, message_count INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL, timestamp TEXT NOT NULL, tool_calls TEXT
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(content, content='messages', content_rowid='rowid', tokenize='trigram');
  CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO message_fts(rowid, content) VALUES (new.rowid, new.content);
  END;
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT,
    target TEXT NOT NULL CHECK (target IN ('memory', 'user', 'failure')),
    category TEXT, content TEXT NOT NULL, failure_reason TEXT, tool_state TEXT, corrected_to TEXT,
    created DATE NOT NULL, last_referenced DATE NOT NULL, hit_count INTEGER NOT NULL DEFAULT 0, last_hit_at DATE
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(content, content='memories', content_rowid='id', tokenize='trigram');
  CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
  END;
  CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
  CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
`;

export interface FxMessage {
  session: string;
  content: string;
  ts: string;
  role?: "user" | "assistant" | "system";
  id?: string;
}
interface FxMemory {
  project: string | null;
  content: string;
  created: string;
  target?: "memory" | "user" | "failure";
}
export interface FxDb {
  sessions: Array<{ id: string; project: string }>;
  messages: FxMessage[];
  memories?: FxMemory[];
}

let seq = 0;

/** Create the DB at `path`. `wal: true` keeps the handle open with uncheckpointed frames; call `close()` when done. */
export function createHermesDb(path: string, fx: FxDb, opts: { wal?: boolean } = {}): { db: DatabaseSync; close(): void } {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (opts.wal) db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
  db.exec(HERMES_SCHEMA_SQL);
  const s = db.prepare("INSERT INTO sessions (id, project, cwd, started_at) VALUES (?, ?, ?, ?)");
  for (const x of fx.sessions) s.run(x.id, x.project, `/synthetic/${x.project}`, "2026-01-01T00:00:00.000Z");
  const m = db.prepare("INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  for (const x of fx.messages) m.run(x.id ?? `msg-${seq++}`, x.session, x.role ?? "user", x.content, x.ts);
  db.exec("COMMIT");
  const mem = db.prepare("INSERT INTO memories (project, target, content, created, last_referenced) VALUES (?, ?, ?, ?, ?)");
  for (const x of fx.memories ?? []) mem.run(x.project, x.target ?? "memory", x.content, x.created, x.created);
  return { db, close: () => db.close() };
}

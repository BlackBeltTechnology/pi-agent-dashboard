/**
 * The archive transition + in-memory archive index.
 *
 * Single owner of every archive state change (manual, sweep, boot migration):
 * the sidecar write, the eviction from the live session set, the index row and
 * the browser broadcast can therefore never disagree. Also owns the
 * `Map<groupKey, ArchivedSessionSummary[]>` index that backs per-folder counts
 * and the on-demand listing/search endpoints (served with no disk IO).
 *
 * `groupKey` is `pathKey(resolveSessionGroupPath(row))` — the SAME normalised
 * key the client groups folders by, so path-spelling drift and worktree
 * sessions resolve identically on both sides.
 *
 * See change: archive-sessions-lazy-load.
 */
import { existsSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { ArchivedSessionSummary } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { mergeSessionMeta, metaPath, readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { pathKey, resolveSessionGroupPath } from "@blackbelt-technology/pi-dashboard-shared/session-group-path.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { MetaPersistence } from "../persistence/meta-persistence.js";
import type { SessionManager } from "./memory-session-manager.js";
import { sessionFromMeta } from "./session-scanner.js";

type ArchiveReason = "manual" | "sweep" | "migration";

/** Broadcast port, late-bound after the browser gateway exists. */
interface SessionArchiveEmitter {
  sessionArchived(sessionId: string, cwd: string, count: number): void;
  archivedCountUpdated(cwd: string, count: number): void;
  sessionAdded(session: DashboardSession): void;
}

export interface SessionArchiveDeps {
  sessionManager: SessionManager;
  metaPersistence: Pick<MetaPersistence, "flush">;
  /** Pinned directory spellings (the group-path resolver's pin tier). */
  getPinnedDirs: () => string[];
  platform?: NodeJS.Platform;
  now?: () => number;
}

interface ArchiveResult {
  ok: boolean;
  error?: string;
  /** True when an idle-alive session's end was issued (archive completes later). */
  pending?: boolean;
  session?: DashboardSession;
}

interface ArchivedListQuery {
  cwd?: string;
  limit: number;
  cursor?: string;
  q?: string;
}

interface ArchivedListResult {
  items: ArchivedSessionSummary[];
  nextCursor?: string;
}

export interface SessionArchive {
  /** Seed the index from the boot scan's archived rows. */
  seed(rows: ArchivedSessionSummary[]): void;
  /** Re-key every row after a pinned-directory change; broadcasts changed counts. */
  rekey(): void;
  countsByKey(): Record<string, number>;
  getById(id: string): ArchivedSessionSummary | undefined;
  has(id: string): boolean;
  rows(): ArchivedSessionSummary[];
  /** Archive an ended, non-live session. Caller handles idle-alive intent. */
  archiveSession(id: string, reason: ArchiveReason): ArchiveResult;
  /** Restore an archived session into the live set as ended. */
  unarchiveSession(id: string): ArchiveResult;
  /** Delete an archived session's files and index row. */
  deleteArchived(id: string): ArchiveResult & { notFound?: boolean };
  /** A bridge re-registered an archived id: drop the index row + broadcast. */
  onBridgeRegister(id: string): void;
  setEmitter(emitter: SessionArchiveEmitter): void;
  list(query: ArchivedListQuery): ArchivedListResult;
}

/** Encode the `(endedAt, id)` cursor as opaque base64. */
function encodeCursor(endedAt: number, id: string): string {
  return Buffer.from(`${endedAt}:${id}`, "utf-8").toString("base64");
}

/** Decode an opaque cursor; `null` when undecodable. */
export function decodeCursor(cursor: string): { endedAt: number; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64").toString("utf-8");
    const idx = raw.indexOf(":");
    if (idx === -1) return null;
    const endedAt = Number(raw.slice(0, idx));
    const id = raw.slice(idx + 1);
    if (!Number.isFinite(endedAt) || !id) return null;
    return { endedAt, id };
  } catch {
    return null;
  }
}

/** Newest-ended first, `id` desc as the deterministic tiebreak. */
function compareRows(a: ArchivedSessionSummary, b: ArchivedSessionSummary): number {
  if (b.endedAt !== a.endedAt) return b.endedAt - a.endedAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** `q` matches `name` (or `firstMessage` when there is no name), lowercase substring. */
function matchesQuery(row: ArchivedSessionSummary, q: string): boolean {
  const needle = q.toLowerCase();
  if (row.name && row.name.length > 0) return row.name.toLowerCase().includes(needle);
  return (row.firstMessage ?? "").toLowerCase().includes(needle);
}

export function createSessionArchive(deps: SessionArchiveDeps): SessionArchive {
  const { sessionManager, metaPersistence } = deps;
  const platform = deps.platform ?? process.platform;
  const now = deps.now ?? (() => Date.now());

  // groupKey -> rows. Rebuilt wholesale by `rekey()`.
  let index = new Map<string, ArchivedSessionSummary[]>();
  let emitter: SessionArchiveEmitter | undefined;

  const pinnedKeys = (): Set<string> => {
    const dirs = deps.getPinnedDirs() ?? [];
    return new Set(dirs.map((d) => pathKey(d, platform)));
  };

  function groupKeyFor(row: ArchivedSessionSummary, pinned: Set<string>): string {
    const groupPath = resolveSessionGroupPath(
      { cwd: row.cwd, gitWorktree: row.gitWorktree },
      pinned,
      platform,
    );
    return pathKey(groupPath, platform);
  }

  function rebuild(rows: ArchivedSessionSummary[]): void {
    const pinned = pinnedKeys();
    const next = new Map<string, ArchivedSessionSummary[]>();
    for (const row of rows) {
      const key = groupKeyFor(row, pinned);
      row.groupPath = resolveSessionGroupPath(
        { cwd: row.cwd, gitWorktree: row.gitWorktree },
        pinned,
        platform,
      );
      const list = next.get(key);
      if (list) list.push(row);
      else next.set(key, [row]);
    }
    index = next;
  }

  function allRows(): ArchivedSessionSummary[] {
    const out: ArchivedSessionSummary[] = [];
    for (const list of index.values()) out.push(...list);
    return out;
  }

  function findRow(id: string): ArchivedSessionSummary | undefined {
    for (const list of index.values()) {
      const row = list.find((r) => r.id === id);
      if (row) return row;
    }
    return undefined;
  }

  function countFor(key: string): number {
    return index.get(key)?.length ?? 0;
  }

  function removeRow(id: string): ArchivedSessionSummary | undefined {
    for (const [key, list] of index) {
      const idx = list.findIndex((r) => r.id === id);
      if (idx !== -1) {
        const [row] = list.splice(idx, 1);
        if (list.length === 0) index.delete(key);
        return row;
      }
    }
    return undefined;
  }

  function insertRow(row: ArchivedSessionSummary): void {
    const key = groupKeyFor(row, pinnedKeys());
    row.groupPath = resolveSessionGroupPath(
      { cwd: row.cwd, gitWorktree: row.gitWorktree },
      pinnedKeys(),
      platform,
    );
    const list = index.get(key);
    if (list) list.push(row);
    else index.set(key, [row]);
  }

  return {
    seed(rows) {
      rebuild(rows);
    },

    rows() {
      return allRows();
    },

    rekey() {
      // Capture the counts the OLD keys had so we can broadcast every key whose
      // count actually changed (removed and added alike).
      const before = new Map<string, number>();
      for (const [key, list] of index) before.set(key, list.length);
      rebuild(allRows());
      const keys = new Set<string>([...before.keys(), ...index.keys()]);
      for (const key of keys) {
        const prev = before.get(key) ?? 0;
        const next = countFor(key);
        if (prev !== next) emitter?.archivedCountUpdated(key, next);
      }
    },

    countsByKey() {
      const counts: Record<string, number> = {};
      for (const [key, list] of index) {
        if (list.length > 0) counts[key] = list.length;
      }
      return counts;
    },

    getById(id) {
      return findRow(id);
    },

    has(id) {
      return findRow(id) !== undefined;
    },

    archiveSession(id, _reason) {
      const session = sessionManager.get(id);
      if (!session) return { ok: false, error: "session not found" };
      if (session.live === true) return { ok: false, error: "session is live (interrupted)" };
      if (session.status !== "ended") return { ok: false, error: "session is not ended" };
      if (!session.sessionFile) return { ok: false, error: "session file is unknown" };

      const archivedAt = now();
      try {
        // Flush a queued debounced write BEFORE the eager archive write so a
        // pending rename/tag survives. Then merge (not overwrite) so unknown
        // sidecar fields are preserved.
        metaPersistence.flush(session.sessionFile);
        mergeSessionMeta(session.sessionFile, { archived: true, archivedAt });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }

      const captured: ArchivedSessionSummary = {
        id: session.id,
        name: session.name,
        firstMessage: session.firstMessage,
        cwd: session.cwd,
        groupPath: session.cwd,
        gitWorktree: session.gitWorktree
          ? { mainPath: session.gitWorktree.mainPath, name: session.gitWorktree.name }
          : undefined,
        endedAt: session.endedAt ?? session.lastActivityAt ?? session.startedAt,
        archivedAt,
        sessionFile: session.sessionFile,
      };
      sessionManager.remove(id);
      insertRow(captured);
      const key = groupKeyFor(captured, pinnedKeys());
      emitter?.sessionArchived(id, key, countFor(key));
      return { ok: true };
    },

    unarchiveSession(id) {
      const row = findRow(id);
      if (!row) return { ok: false, error: "session is not archived" };
      const meta = readSessionMeta(row.sessionFile) ?? {};
      const startedAt = meta.startedAt ?? row.endedAt;
      const restored = sessionFromMeta(id, row.sessionFile, dirname(row.sessionFile), meta, startedAt);
      const session: DashboardSession = {
        ...restored,
        // Restore re-adds the session to the live set as ended. The archived
        // sidecar may carry a stale non-ended status (boot migrates clean-stop
        // sidecars that never persisted `ended`), so force it.
        status: "ended",
        endedAt: restored.endedAt ?? row.endedAt,
        archived: false,
        archivedAt: undefined,
        restoredAt: now(),
        // Restoring is an explicit "show me this"; a migrated row still carries
        // hidden:true, which would otherwise keep it behind `Show hidden`.
        hidden: false,
        dataUnavailable: true,
      };
      try {
        mergeSessionMeta(row.sessionFile, {
          archived: false,
          restoredAt: session.restoredAt,
          hidden: false,
        });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      sessionManager.restore(session);
      removeRow(id);
      const key = groupKeyFor(row, pinnedKeys());
      emitter?.sessionAdded(session);
      emitter?.archivedCountUpdated(key, countFor(key));
      return { ok: true, session };
    },

    deleteArchived(id) {
      const row = findRow(id);
      if (!row) return { ok: false, error: "session is not archived", notFound: true };
      const jsonl = row.sessionFile;
      const sidecar = jsonl ? metaPath(jsonl) : "";
      try {
        if (jsonl) {
          try {
            unlinkSync(jsonl);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
          }
        }
        if (sidecar) {
          try {
            unlinkSync(sidecar);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
          }
        }
      } catch (err) {
        console.error(`[archive] delete failed for ${id}:`, err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      removeRow(id);
      const key = groupKeyFor(row, pinnedKeys());
      emitter?.archivedCountUpdated(key, countFor(key));
      return { ok: true };
    },

    onBridgeRegister(id) {
      const row = removeRow(id);
      if (!row) return;
      // Clear the on-disk marker too — register's debounced onChange save would
      // eventually overwrite it, but the index is authoritative now.
      if (row.sessionFile && existsSync(row.sessionFile)) {
        try {
          mergeSessionMeta(row.sessionFile, { archived: false });
        } catch {
          /* best-effort */
        }
      }
      const key = groupKeyFor(row, pinnedKeys());
      emitter?.archivedCountUpdated(key, countFor(key));
    },

    setEmitter(next) {
      emitter = next;
    },

    list(query) {
      const { limit, cursor, q } = query;
      const candidates: ArchivedSessionSummary[] = [];
      // q wins over cwd-scoping for the search chip (all folders unless cwd given).
      if (q !== undefined && q.length > 0) {
        if (q.length < 3) return { items: [] };
        const scope = query.cwd !== undefined ? index.get(pathKey(query.cwd, platform)) ?? [] : allRows();
        for (const row of scope) if (matchesQuery(row, q)) candidates.push(row);
      } else if (query.cwd !== undefined) {
        candidates.push(...(index.get(pathKey(query.cwd, platform)) ?? []));
      } else {
        candidates.push(...allRows());
      }

      candidates.sort(compareRows);

      let start = 0;
      if (cursor !== undefined && cursor.length > 0) {
        const decoded = decodeCursor(cursor);
        if (decoded) {
          // Find the first row strictly after the cursor position in sort order.
          start = candidates.findIndex(
            (r) => r.endedAt < decoded.endedAt || (r.endedAt === decoded.endedAt && r.id < decoded.id),
          );
          if (start === -1) start = candidates.length;
        }
      }

      const page = candidates.slice(start, start + limit + 1);
      const hasMore = page.length > limit;
      const items = hasMore ? page.slice(0, limit) : page;
      const last = items[items.length - 1];
      const nextCursor = hasMore && last ? encodeCursor(last.endedAt, last.id) : undefined;
      return nextCursor ? { items, nextCursor } : { items };
    },
  };
}

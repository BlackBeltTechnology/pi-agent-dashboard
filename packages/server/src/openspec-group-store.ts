/**
 * Per-repo OpenSpec change-grouping store.
 *
 * On-disk shape: `<cwd>/openspec/groups/groups.json` containing
 * `{ schemaVersion, groups, assignments }`. File is opt-in: absent → empty
 * default. First write creates the directory atomically.
 *
 * Concurrency model:
 *   - Reads stat the file (microseconds, OS-cached) and short-circuit on a
 *     `(mtimeMs, size)` cache hit. Concurrent reads in the same tick share
 *     a single in-flight promise to avoid stampedes.
 *   - Writes serialize per-cwd via a FIFO promise chain. Inside the
 *     critical section the store re-stats before rename; on mtime drift
 *     it re-reads, re-applies the mutator, and retries once. A second
 *     drift surfaces as `ConcurrentEditError` (HTTP 409 at the route).
 *   - After every successful write a 100 ms trailing debounce schedules
 *     one `subscribe()` callback per cwd, regardless of write rate.
 *
 * See change: add-openspec-change-grouping (tasks 2.1–2.17).
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  OPENSPEC_GROUPS_SCHEMA_VERSION,
  type OpenSpecData,
  type OpenSpecGroup,
  type OpenSpecGroupsFile,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Pure helper. Returns a new `OpenSpecData` with every `OpenSpecChange.groupId`
 * populated from the provided assignments map (`changeName → groupId`).
 * Changes without an entry get `groupId: null` (Ungrouped). Used by
 * `directory-service` after `buildOpenSpecData` and before broadcast so all
 * clients see a single joined view.
 *
 * See change: add-openspec-change-grouping (tasks 4.1–4.2).
 */
export function joinGroupIdsToOpenSpecData(
  data: OpenSpecData,
  assignments: Record<string, string>,
): OpenSpecData {
  return {
    ...data,
    changes: data.changes.map((c) => ({
      ...c,
      groupId: assignments[c.name] ?? null,
    })),
  };
}

// ── Errors ───────────────────────────────────────────────────────

export class ConcurrentEditError extends Error {
  /** Current on-disk payload at the time the conflict was detected. */
  readonly current: OpenSpecGroupsFile;
  constructor(current: OpenSpecGroupsFile) {
    super("Concurrent edit detected");
    this.name = "ConcurrentEditError";
    this.current = current;
  }
}

export class UnsupportedSchemaVersionError extends Error {
  readonly version: unknown;
  constructor(version: unknown, message?: string) {
    super(message ?? `unsupported schema version: ${String(version)}`);
    this.name = "UnsupportedSchemaVersionError";
    this.version = version;
  }
}

export class GroupNotFoundError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`Group not found: ${id}`);
    this.name = "GroupNotFoundError";
    this.id = id;
  }
}

export class UnknownGroupIdError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`Unknown groupId: ${id}`);
    this.name = "UnknownGroupIdError";
    this.id = id;
  }
}

// ── Public surface ───────────────────────────────────────────────

export interface OpenSpecGroupStoreOptions {
  /** Trailing-debounce window for subscriber callbacks in ms. Default 100. */
  debounceMs?: number;
  /**
   * Test-only hook fired AFTER the temp file is staged, BEFORE the rename.
   * Tests use this to simulate hand-edit / `git pull` races. Production
   * MUST leave this undefined.
   */
  __testHookBeforeRename?: (cwd: string) => Promise<void> | void;
}

export interface OpenSpecGroupStore {
  read(cwd: string): Promise<OpenSpecGroupsFile>;
  createGroup(cwd: string, body: { name: string; color?: string }): Promise<OpenSpecGroup>;
  updateGroup(
    cwd: string,
    id: string,
    body: { name?: string; color?: string; order?: number },
  ): Promise<OpenSpecGroup>;
  deleteGroup(cwd: string, id: string): Promise<void>;
  setAssignment(cwd: string, changeName: string, groupId: string | null): Promise<void>;
  /**
   * Replace the persisted manual change ordering for one group (or the
   * implicit Ungrouped column, keyed by `OPENSPEC_UNGROUPED_KEY`). The
   * order array is stored verbatim; stale entries (changes no longer in the
   * group) are tolerated and ignored by clients on render.
   * See change: redesign-openspec-board.
   */
  setChangeOrder(cwd: string, groupId: string, order: string[]): Promise<void>;
  /**
   * Subscribe to debounced post-write broadcasts. Returns an unsubscribe fn.
   * The callback receives the cwd plus the latest groups/assignments/order.
   */
  subscribe(
    cb: (cwd: string, payload: { groups: OpenSpecGroup[]; assignments: Record<string, string>; changeOrder: Record<string, string[]> }) => void,
  ): () => void;
  /** Flushes pending broadcasts and clears caches. Tests + shutdown. */
  dispose(): void;
}

// ── Internal cache shape ─────────────────────────────────────────

interface CacheEntry {
  mtimeMs: number;
  size: number;
  data: OpenSpecGroupsFile | undefined;
  inFlight?: Promise<OpenSpecGroupsFile>;
}

const DEFAULT_DEBOUNCE_MS = 100;

function emptyFile(): OpenSpecGroupsFile {
  return { schemaVersion: OPENSPEC_GROUPS_SCHEMA_VERSION, groups: [], assignments: {} };
}

function pathFor(cwd: string): string {
  return path.join(cwd, "openspec", "groups", "groups.json");
}

function dirFor(cwd: string): string {
  return path.join(cwd, "openspec", "groups");
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base : "group";
}

function uniqueSlug(base: string, existing: ReadonlySet<string>): string {
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function validateSchemaVersion(parsed: unknown): asserts parsed is OpenSpecGroupsFile {
  if (typeof parsed !== "object" || parsed === null) {
    throw new UnsupportedSchemaVersionError(undefined, "groups.json must be an object");
  }
  const v = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (v === undefined) {
    throw new UnsupportedSchemaVersionError(undefined, "missing schemaVersion field");
  }
  if (v !== OPENSPEC_GROUPS_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(v);
  }
}

/** Re-pack `order` values to contiguous `0..N-1` while preserving sort order. */
function normalizeOrders(groups: OpenSpecGroup[]): OpenSpecGroup[] {
  const sorted = [...groups].sort((a, b) => a.order - b.order);
  return sorted.map((g, i) => ({ ...g, order: i }));
}

// ── Factory ──────────────────────────────────────────────────────

export function createOpenSpecGroupStore(
  opts: OpenSpecGroupStoreOptions = {},
): OpenSpecGroupStore {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const hook = opts.__testHookBeforeRename;

  const cache = new Map<string, CacheEntry>();
  const writeMutex = new Map<string, Promise<void>>();
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  type Subscriber = (
    cwd: string,
    payload: { groups: OpenSpecGroup[]; assignments: Record<string, string>; changeOrder: Record<string, string[]> },
  ) => void;
  const subscribers = new Set<Subscriber>();

  function broadcastPayload(file: OpenSpecGroupsFile) {
    return {
      groups: file.groups,
      assignments: file.assignments,
      changeOrder: file.changeOrder ?? {},
    };
  }

  async function tryStat(filePath: string): Promise<{ mtimeMs: number; size: number } | null> {
    try {
      const s = await fs.stat(filePath);
      return { mtimeMs: s.mtimeMs, size: s.size };
    } catch (err: any) {
      if (err?.code === "ENOENT") return null;
      throw err;
    }
  }

  /**
   * Read the file via the mtime-gated cache. Returns the empty default when
   * absent. Throws `UnsupportedSchemaVersionError` on bad version.
   */
  async function read(cwd: string): Promise<OpenSpecGroupsFile> {
    const filePath = pathFor(cwd);

    // Short-circuit a concurrent in-flight read.
    const existing = cache.get(cwd);
    if (existing?.inFlight) return existing.inFlight;

    const inFlight = (async (): Promise<OpenSpecGroupsFile> => {
      const stat = await tryStat(filePath);
      if (!stat) {
        cache.delete(cwd);
        return emptyFile();
      }
      const cached = cache.get(cwd);
      if (cached?.data && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.data;
      }
      const raw = await fs.readFile(filePath, "utf-8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new UnsupportedSchemaVersionError(undefined, `groups.json parse error: ${(err as Error).message}`);
      }
      validateSchemaVersion(parsed);
      const data = parsed as OpenSpecGroupsFile;
      cache.set(cwd, { mtimeMs: stat.mtimeMs, size: stat.size, data });
      return data;
    })();

    // Stash the in-flight promise so concurrent callers share it.
    const slot: CacheEntry = existing ?? { mtimeMs: 0, size: 0, data: undefined };
    slot.inFlight = inFlight;
    cache.set(cwd, slot);

    try {
      return await inFlight;
    } finally {
      const e = cache.get(cwd);
      if (e?.inFlight === inFlight) {
        delete e.inFlight;
        // If the read produced no data (e.g. file vanished mid-read), purge
        // the placeholder slot rather than leak `mtimeMs: 0` forever.
        if (!e.data) cache.delete(cwd);
      }
    }
  }

  /**
   * Run a per-cwd mutation under the FIFO mutex. The mutator receives the
   * current file payload and returns a fresh payload. Implements the
   * mtime-recheck-before-rename + 1-shot retry on race.
   */
  async function mutate<T>(
    cwd: string,
    mutator: (current: OpenSpecGroupsFile) => { next: OpenSpecGroupsFile; result: T },
  ): Promise<T> {
    const prev = writeMutex.get(cwd) ?? Promise.resolve();
    let release!: () => void;
    const slot = new Promise<void>((resolve) => {
      release = resolve;
    });
    writeMutex.set(cwd, prev.then(() => slot));

    try {
      await prev;
      // Try once, then retry once on race.
      for (let attempt = 0; attempt < 2; attempt++) {
        const filePath = pathFor(cwd);
        const preStat = await tryStat(filePath);
        const preMtime = preStat?.mtimeMs ?? null;
        const preSize = preStat?.size ?? null;
        const current = await read(cwd);
        const { next, result } = mutator(current);
        const tmpPath = filePath + ".tmp";
        await fs.mkdir(dirFor(cwd), { recursive: true });
        const serialized = JSON.stringify(next, null, 2) + "\n";
        await fs.writeFile(tmpPath, serialized);
        if (hook) {
          await hook(cwd);
        }
        // Re-stat the original; if mtime/size changed since pre-read, race.
        const postStat = await tryStat(filePath);
        const postMtime = postStat?.mtimeMs ?? null;
        const postSize = postStat?.size ?? null;
        const raced = preMtime !== postMtime || preSize !== postSize;
        if (raced) {
          // Drop temp; retry once, else throw.
          await fs.rm(tmpPath, { force: true });
          if (attempt === 0) continue;
          // Surface current payload for HTTP 409.
          // Force a fresh read by invalidating the cache.
          cache.delete(cwd);
          const currentFile = await read(cwd);
          throw new ConcurrentEditError(currentFile);
        }
        await fs.rename(tmpPath, filePath);
        // Update cache directly with the new file's stat.
        const finalStat = await fs.stat(filePath);
        cache.set(cwd, {
          mtimeMs: finalStat.mtimeMs,
          size: finalStat.size,
          data: next,
        });
        scheduleBroadcast(cwd, next);
        return result;
      }
      // Unreachable.
      throw new ConcurrentEditError(await read(cwd));
    } finally {
      release();
      // Clean up exhausted mutex slots so the map doesn't leak per-cwd.
      // Once the chain is fully drained, drop the entry.
      // (No-op when newer writes are queued behind us.)
      Promise.resolve(writeMutex.get(cwd)).then(() => {
        // If still pointing at our slot's tail, drop.
        if (writeMutex.get(cwd) === prev.then(() => slot)) writeMutex.delete(cwd);
      }).catch(() => {});
    }
  }

  function scheduleBroadcast(cwd: string, file: OpenSpecGroupsFile): void {
    if (subscribers.size === 0) return;
    const existing = debounceTimers.get(cwd);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      debounceTimers.delete(cwd);
      // Always emit the freshest cached payload for this cwd, not the file
      // captured when the timer was scheduled — matters for coalesced bursts.
      const latest = cache.get(cwd)?.data ?? file;
      const payload = broadcastPayload(latest);
      for (const cb of subscribers) {
        try {
          cb(cwd, payload);
        } catch {
          /* subscriber threw — swallow so other subs still fire */
        }
      }
    }, debounceMs);
    debounceTimers.set(cwd, timer);
  }

  // ── Public methods ───────────────────────────────────────────

  async function createGroup(
    cwd: string,
    body: { name: string; color?: string },
  ): Promise<OpenSpecGroup> {
    return mutate(cwd, (current) => {
      const existingIds = new Set(current.groups.map((g) => g.id));
      const id = uniqueSlug(slugify(body.name), existingIds);
      const newGroup: OpenSpecGroup = {
        id,
        name: body.name,
        ...(body.color !== undefined ? { color: body.color } : {}),
        order: current.groups.length,
      };
      const next: OpenSpecGroupsFile = {
        ...current,
        schemaVersion: OPENSPEC_GROUPS_SCHEMA_VERSION,
        groups: [...current.groups, newGroup],
      };
      return { next, result: newGroup };
    });
  }

  async function updateGroup(
    cwd: string,
    id: string,
    body: { name?: string; color?: string; order?: number },
  ): Promise<OpenSpecGroup> {
    return mutate(cwd, (current) => {
      const target = current.groups.find((g) => g.id === id);
      if (!target) throw new GroupNotFoundError(id);

      // Apply scalar updates first (name, color).
      const updatedTarget: OpenSpecGroup = {
        ...target,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.order !== undefined ? { order: body.order } : {}),
      };

      const replaced = current.groups.map((g) => (g.id === id ? updatedTarget : g));

      // If order was touched, normalize the whole set to contiguous 0..N-1.
      // Keep `updatedTarget` at its requested slot, push others around it.
      const finalGroups =
        body.order === undefined
          ? replaced
          : (() => {
              // Sort: target sits first at its requested order; others keep
              // their relative ordering. Then re-pack indexes.
              const others = replaced.filter((g) => g.id !== id).sort((a, b) => a.order - b.order);
              // Insert target at clamped position.
              const pos = Math.max(0, Math.min(body.order!, others.length));
              const merged = [...others];
              merged.splice(pos, 0, updatedTarget);
              return merged.map((g, i) => ({ ...g, order: i }));
            })();

      const next: OpenSpecGroupsFile = {
        ...current,
        schemaVersion: OPENSPEC_GROUPS_SCHEMA_VERSION,
        groups: finalGroups,
      };
      const finalTarget = finalGroups.find((g) => g.id === id)!;
      return { next, result: finalTarget };
    });
  }

  async function deleteGroup(cwd: string, id: string): Promise<void> {
    return mutate(cwd, (current) => {
      const exists = current.groups.some((g) => g.id === id);
      if (!exists) throw new GroupNotFoundError(id);
      const remaining = normalizeOrders(current.groups.filter((g) => g.id !== id));
      // Cascade: remove any assignment pointing at the deleted group.
      const trimmed: Record<string, string> = {};
      for (const [k, v] of Object.entries(current.assignments)) {
        if (v !== id) trimmed[k] = v;
      }
      const next: OpenSpecGroupsFile = {
        schemaVersion: OPENSPEC_GROUPS_SCHEMA_VERSION,
        groups: remaining,
        assignments: trimmed,
      };
      return { next, result: undefined };
    });
  }

  async function setAssignment(
    cwd: string,
    changeName: string,
    groupId: string | null,
  ): Promise<void> {
    return mutate(cwd, (current) => {
      if (groupId !== null && !current.groups.some((g) => g.id === groupId)) {
        throw new UnknownGroupIdError(groupId);
      }
      const next: OpenSpecGroupsFile = {
        ...current,
        schemaVersion: OPENSPEC_GROUPS_SCHEMA_VERSION,
        assignments: { ...current.assignments },
      };
      if (groupId === null) {
        delete next.assignments[changeName];
      } else {
        next.assignments[changeName] = groupId;
      }
      return { next, result: undefined };
    });
  }

  async function setChangeOrder(
    cwd: string,
    groupId: string,
    order: string[],
  ): Promise<void> {
    return mutate(cwd, (current) => {
      const next: OpenSpecGroupsFile = {
        ...current,
        schemaVersion: OPENSPEC_GROUPS_SCHEMA_VERSION,
        changeOrder: { ...(current.changeOrder ?? {}), [groupId]: [...order] },
      };
      return { next, result: undefined };
    });
  }

  function subscribe(cb: Subscriber): () => void {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  }

  function dispose(): void {
    for (const t of debounceTimers.values()) clearTimeout(t);
    debounceTimers.clear();
    subscribers.clear();
    cache.clear();
    writeMutex.clear();
  }

  return {
    read,
    createGroup,
    updateGroup,
    deleteGroup,
    setAssignment,
    setChangeOrder,
    subscribe,
    dispose,
  };
}

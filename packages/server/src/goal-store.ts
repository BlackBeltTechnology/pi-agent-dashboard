/**
 * Folder-scoped goal record store.
 *
 * On-disk shape: `~/.pi/dashboard/goals/<folderHash(cwd)>.json` containing
 * `{ schemaVersion, goals }`. Dashboard-owned (single-writer, never
 * hand-edited in the repo), so this store is simpler than
 * `openspec-group-store.ts`: no concurrent-edit detection, no group/order
 * machinery. It keeps the same atomic tmp+rename write, an in-memory cache,
 * and a debounced `subscribe()` broadcast.
 *
 * The dashboard owns the durable `GoalRecord`; the @ricoyudog/pi-goal-hermes
 * extension stays source of truth for live loop state (associated by
 * `goalId`). See change: add-goals-folder-page (design.md Q1).
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import {
  GOALS_SCHEMA_VERSION,
  GOAL_VERDICTS_CAP,
  type GoalRecord,
  type GoalRecordStatus,
  type GoalCriterion,
  type GoalBudget,
  type GoalJudge,
  type GoalVerdict,
  type GoalsFile,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";

// ── Errors ───────────────────────────────────────────────────────

export class GoalNotFoundError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`Goal not found: ${id}`);
    this.name = "GoalNotFoundError";
    this.id = id;
  }
}

// ── Public surface ───────────────────────────────────────────────

export interface GoalCreateBody {
  objective: string;
  criteria?: GoalCriterion[];
  budget?: GoalBudget;
  judge?: GoalJudge;
}

export interface GoalUpdateBody {
  objective?: string;
  criteria?: GoalCriterion[];
  status?: GoalRecordStatus;
  budget?: GoalBudget;
  judge?: GoalJudge;
  driverSessionId?: string;
}

export interface GoalStoreOptions {
  /** Root dir for goal files. Default `~/.pi/dashboard/goals`. */
  dataDir?: string;
  /** Trailing-debounce window for subscriber callbacks in ms. Default 100. */
  debounceMs?: number;
}

export interface GoalStore {
  list(cwd: string): Promise<GoalRecord[]>;
  create(cwd: string, body: GoalCreateBody): Promise<GoalRecord>;
  update(cwd: string, id: string, body: GoalUpdateBody): Promise<GoalRecord>;
  /** Delete a goal. Returns the sessionIds that were linked (caller clears their meta). */
  delete(cwd: string, id: string): Promise<string[]>;
  /** Add a session to a goal (idempotent). Sets driverSessionId if unset. */
  linkSession(cwd: string, id: string, sessionId: string): Promise<GoalRecord>;
  /** Remove a session from a goal. Clears driverSessionId if it pointed at it. */
  unlinkSession(cwd: string, id: string, sessionId: string): Promise<GoalRecord>;
  /** Append a judge verdict to a goal (FIFO-capped at GOAL_VERDICTS_CAP). */
  appendVerdict(cwd: string, id: string, verdict: GoalVerdict): Promise<GoalRecord>;
  subscribe(cb: (cwd: string, payload: { goals: GoalRecord[] }) => void): () => void;
  dispose(): void;
}

const DEFAULT_DEBOUNCE_MS = 100;

function folderHash(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 12);
}

function emptyFile(): GoalsFile {
  return { schemaVersion: GOALS_SCHEMA_VERSION, goals: [] };
}

// ── Factory ──────────────────────────────────────────────────────

export function createGoalStore(opts: GoalStoreOptions = {}): GoalStore {
  const dataDir = opts.dataDir ?? path.join(os.homedir(), ".pi", "dashboard", "goals");
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const cache = new Map<string, GoalsFile>();
  const writeMutex = new Map<string, Promise<void>>();
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  type Subscriber = (cwd: string, payload: { goals: GoalRecord[] }) => void;
  const subscribers = new Set<Subscriber>();

  function fileFor(cwd: string): string {
    return path.join(dataDir, `${folderHash(cwd)}.json`);
  }

  async function read(cwd: string): Promise<GoalsFile> {
    const cached = cache.get(cwd);
    if (cached) return cached;
    let data: GoalsFile;
    try {
      const raw = await fs.readFile(fileFor(cwd), "utf-8");
      const parsed = JSON.parse(raw) as GoalsFile;
      data = parsed && Array.isArray(parsed.goals) ? parsed : emptyFile();
    } catch (err: any) {
      // Only a genuinely-absent file is an empty store. Surfacing parse/perm
      // errors prevents a malformed file from being silently replaced with an
      // empty store (whose next write would erase persisted goals).
      if (err?.code && err.code !== "ENOENT") throw err;
      data = emptyFile();
    }
    cache.set(cwd, data);
    return data;
  }

  async function mutate<T>(
    cwd: string,
    mutator: (current: GoalsFile) => { next: GoalsFile; result: T },
  ): Promise<T> {
    const prev = writeMutex.get(cwd) ?? Promise.resolve();
    let release!: () => void;
    const slot = new Promise<void>((resolve) => {
      release = resolve;
    });
    writeMutex.set(cwd, prev.then(() => slot));
    try {
      await prev;
      const current = await read(cwd);
      const { next, result } = mutator(current);
      const filePath = fileFor(cwd);
      await fs.mkdir(dataDir, { recursive: true });
      const tmpPath = filePath + ".tmp";
      await fs.writeFile(tmpPath, JSON.stringify(next, null, 2) + "\n");
      await fs.rename(tmpPath, filePath);
      cache.set(cwd, next);
      scheduleBroadcast(cwd, next);
      return result;
    } finally {
      release();
    }
  }

  function scheduleBroadcast(cwd: string, file: GoalsFile): void {
    if (subscribers.size === 0) return;
    const existing = debounceTimers.get(cwd);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      debounceTimers.delete(cwd);
      const latest = cache.get(cwd) ?? file;
      const goals = latest.goals.map((g) => ({ ...g }));
      for (const cb of subscribers) {
        try {
          cb(cwd, { goals });
        } catch {
          /* swallow so other subscribers still fire */
        }
      }
    }, debounceMs);
    debounceTimers.set(cwd, timer);
  }

  function findOrThrow(file: GoalsFile, id: string): GoalRecord {
    const g = file.goals.find((x) => x.id === id);
    if (!g) throw new GoalNotFoundError(id);
    return g;
  }

  // ── Public methods ───────────────────────────────────────────

  async function list(cwd: string): Promise<GoalRecord[]> {
    // Return shallow copies so callers/subscribers can't mutate cached records
    // outside the mutate() critical section.
    return (await read(cwd)).goals.map((g) => ({ ...g }));
  }

  async function create(cwd: string, body: GoalCreateBody): Promise<GoalRecord> {
    return mutate(cwd, (current) => {
      const now = Date.now();
      const record: GoalRecord = {
        id: randomUUID(),
        cwd,
        objective: body.objective,
        criteria: body.criteria ?? [],
        status: "pursuing",
        ...(body.budget !== undefined ? { budget: body.budget } : {}),
        ...(body.judge !== undefined ? { judge: body.judge } : {}),
        sessionIds: [],
        createdAt: now,
        updatedAt: now,
      };
      const next: GoalsFile = {
        schemaVersion: GOALS_SCHEMA_VERSION,
        goals: [...current.goals, record],
      };
      return { next, result: record };
    });
  }

  async function update(cwd: string, id: string, body: GoalUpdateBody): Promise<GoalRecord> {
    return mutate(cwd, (current) => {
      const target = findOrThrow(current, id);
      const updated: GoalRecord = {
        ...target,
        ...(body.objective !== undefined ? { objective: body.objective } : {}),
        ...(body.criteria !== undefined ? { criteria: body.criteria } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.budget !== undefined ? { budget: body.budget } : {}),
        ...(body.judge !== undefined ? { judge: body.judge } : {}),
        ...(body.driverSessionId !== undefined ? { driverSessionId: body.driverSessionId } : {}),
        updatedAt: Date.now(),
      };
      const next: GoalsFile = {
        schemaVersion: GOALS_SCHEMA_VERSION,
        goals: current.goals.map((g) => (g.id === id ? updated : g)),
      };
      return { next, result: updated };
    });
  }

  async function del(cwd: string, id: string): Promise<string[]> {
    return mutate(cwd, (current) => {
      const target = findOrThrow(current, id);
      const next: GoalsFile = {
        schemaVersion: GOALS_SCHEMA_VERSION,
        goals: current.goals.filter((g) => g.id !== id),
      };
      return { next, result: [...target.sessionIds] };
    });
  }

  async function linkSession(cwd: string, id: string, sessionId: string): Promise<GoalRecord> {
    return mutate(cwd, (current) => {
      const target = findOrThrow(current, id);
      const sessionIds = target.sessionIds.includes(sessionId)
        ? target.sessionIds
        : [...target.sessionIds, sessionId];
      const updated: GoalRecord = {
        ...target,
        sessionIds,
        driverSessionId: target.driverSessionId ?? sessionId,
        updatedAt: Date.now(),
      };
      const next: GoalsFile = {
        schemaVersion: GOALS_SCHEMA_VERSION,
        goals: current.goals.map((g) => (g.id === id ? updated : g)),
      };
      return { next, result: updated };
    });
  }

  async function unlinkSession(cwd: string, id: string, sessionId: string): Promise<GoalRecord> {
    return mutate(cwd, (current) => {
      const target = findOrThrow(current, id);
      const updated: GoalRecord = {
        ...target,
        sessionIds: target.sessionIds.filter((s) => s !== sessionId),
        ...(target.driverSessionId === sessionId ? { driverSessionId: undefined } : {}),
        updatedAt: Date.now(),
      };
      const next: GoalsFile = {
        schemaVersion: GOALS_SCHEMA_VERSION,
        goals: current.goals.map((g) => (g.id === id ? updated : g)),
      };
      return { next, result: updated };
    });
  }

  async function appendVerdict(cwd: string, id: string, verdict: GoalVerdict): Promise<GoalRecord> {
    return mutate(cwd, (current) => {
      const target = findOrThrow(current, id);
      const verdicts = [...(target.verdicts ?? []), verdict].slice(-GOAL_VERDICTS_CAP);
      const updated: GoalRecord = { ...target, verdicts, updatedAt: Date.now() };
      const next: GoalsFile = {
        schemaVersion: GOALS_SCHEMA_VERSION,
        goals: current.goals.map((g) => (g.id === id ? updated : g)),
      };
      return { next, result: updated };
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
    list,
    create,
    update,
    delete: del,
    linkSession,
    unlinkSession,
    appendVerdict,
    subscribe,
    dispose,
  };
}

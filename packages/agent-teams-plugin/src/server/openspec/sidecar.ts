/**
 * Per-team profile state: `<dataDir>/openspec/<teamId>.json`, `schemaVersion: 1`, written atomically (temp
 * file + rename, like core's store). Core's team record is never changed.
 *
 * Contract for the modules that share one file (seed, launcher, sync, lock):
 *  - Every mutation goes through `update(teamId, mutate)`: a SYNCHRONOUS read-modify-write on the cached
 *    record (no `await` between the read and the commit), so interleaved writers can never lose each
 *    other's fields. The mutator edits a clone; only a successful write replaces the cache.
 *  - FAIL CLOSED: a failed write returns `sidecar_write_failed` and neither memory nor disk advanced; a team
 *    with no readable sidecar answers `sidecar_missing` and is never rebuilt from empty state.
 *  - A missing / corrupt / future-version sidecar of a live profile team is replaced by a `lost` stub
 *    (`markLost`) that carries the persisted `noticed` flags, so the lead is told once, not at every restart.
 *  - `prune` removes sidecars of unknown/closed teams, never before the team store is hydrated.
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import path from "node:path";
import type { OpenspecProfileKind } from "../../shared/openspec-profile.js";
import type { Logger } from "../types.js";

export const SIDECAR_SCHEMA_VERSION = 1;
const TEAM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

type LaunchState = "launching" | "launched" | "launch_failed";

/** Launcher record per core task id (`openspec-group`). */
export interface LaunchRecord {
  state: LaunchState;
  /** Core member name (`os-<change>` or the hashed form). */
  member: string;
  change: string;
  /** Failure code when `launch_failed`. */
  code?: string;
  at: number;
  /** The lead was told about this record (persisted so a restart does not repeat the notice). */
  noticed?: boolean;
}

/** Named mutex state (`ResourceLock`); `grantMailed` = the `lock_grant` mail of the current holder was sent. */
interface LockRecord {
  holder?: string;
  grantedAt?: number;
  grantMailed?: boolean;
  queue: string[];
}

export interface SidecarData {
  schemaVersion: typeof SIDECAR_SCHEMA_VERSION;
  teamId: string;
  kind: OpenspecProfileKind;
  goal: string;
  /** Real path of the lead cwd the profile was started in. */
  repo: string;
  seeding?: { startedAt: number };
  seeded?: boolean;
  /** The seed stopped before its last task (`code` = core refusal or `crash`); never re-seeded. */
  seedIncomplete?: { code: string };
  /** The original file was missing/corrupt/future: launcher, sync and lock stay off for this team. */
  lost?: { reason: "missing" | "corrupt" | "future" };
  /** Core task id → ref (a change name for `group`, `{ids, hashes}` for `apply`). */
  refs: Record<string, unknown>;
  /** Core task id → launcher record. */
  launched: Record<string, LaunchRecord>;
  /** Core task id → checkbox sync done. */
  synced: Record<string, boolean>;
  /** Resource name → lock state. */
  locks: Record<string, LockRecord>;
  /** Member name → change (the reverse of `memberNameFor`, written once by the group seed; the launcher and the gate derive names from the change and never read it). */
  names: Record<string, string>;
  /** One-shot notice flags (`seed_incomplete`, `sidecar_missing`, `launch_failed:<taskId>`, …). */
  noticed: Record<string, true>;
  /** Room for slice-specific fields without a schema change. */
  ext: Record<string, unknown>;
}

type SidecarFailure = "sidecar_write_failed" | "sidecar_missing";
type SidecarResult<T> = { ok: true; data: T } | { ok: false; error: SidecarFailure; message: string };

/** Synchronous file operations (injectable for fault injection). */
export interface SidecarFs {
  mkdir(dir: string): void;
  readFile(file: string): string;
  writeFile(file: string, data: string): void;
  rename(from: string, to: string): void;
  unlink(file: string): void;
  readdir(dir: string): string[];
}

export const nodeSidecarFs: SidecarFs = {
  mkdir: (dir) => void fs.mkdirSync(dir, { recursive: true, mode: 0o700 }),
  readFile: (file) => fs.readFileSync(file, "utf8"),
  writeFile: (file, data) => fs.writeFileSync(file, data, { encoding: "utf8", mode: 0o600 }),
  rename: (from, to) => fs.renameSync(from, to),
  unlink: (file) => fs.unlinkSync(file),
  readdir: (dir) => fs.readdirSync(dir),
};

export interface SidecarInit {
  teamId: string;
  kind: OpenspecProfileKind;
  goal: string;
  repo: string;
}

interface LoadReport {
  loaded: string[];
  /** File present but unreadable / not JSON / wrong shape. */
  corrupt: string[];
  /** `schemaVersion` greater than this build understands. */
  future: string[];
}

export interface SidecarStore {
  readonly dir: string;
  /** Read every `<teamId>.json` (stray `.tmp` files ignored). Call once at start. */
  load(): LoadReport;
  has(teamId: string): boolean;
  /** `ok` = usable, `lost` = stub (profile features off), `absent` = no record. */
  state(teamId: string): "ok" | "lost" | "absent";
  /** The cached record (do not mutate; use `update`). */
  get(teamId: string): Readonly<SidecarData> | undefined;
  /** Create the record (only when absent; an existing record is returned unchanged and `mutate` does not run). */
  create(init: SidecarInit, mutate?: (draft: SidecarData) => void): SidecarResult<Readonly<SidecarData>>;
  /** Fail-closed synchronous read-modify-write; see the module comment. */
  update(teamId: string, mutate: (draft: SidecarData) => void): SidecarResult<Readonly<SidecarData>>;
  /** Replace a missing/corrupt/future record by a `lost` stub with `noticed.sidecar_missing` set; keeps a bad original as `.corrupt`/`.future`. */
  markLost(init: SidecarInit, reason: "missing" | "corrupt" | "future"): SidecarResult<Readonly<SidecarData>>;
  /** Set a one-shot `noticed` flag; `true` only the first time (and only when it was persisted). */
  noticeOnce(teamId: string, key: string): boolean;
  remove(teamId: string): void;
  /** Drop sidecars whose team is unknown or closed; refuses (returns 0) until `hydrated`. */
  prune(isLive: (teamId: string) => boolean, hydrated: boolean): number;
  /** Number of successful disk writes (tests count them). */
  readonly writes: number;
  /** Team ids with a record. */
  ids(): string[];
}

const emptyData = (init: SidecarInit): SidecarData => ({
  schemaVersion: SIDECAR_SCHEMA_VERSION,
  teamId: init.teamId,
  kind: init.kind,
  goal: init.goal,
  repo: init.repo,
  refs: {},
  launched: {},
  synced: {},
  locks: {},
  names: {},
  noticed: {},
  ext: {},
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const MAP_FIELDS = ["refs", "launched", "synced", "locks", "names", "noticed", "ext"] as const;

/** Optional scalar/marker fields of a persisted record. */
function copyMarkers(raw: Record<string, unknown>, base: SidecarData): void {
  if (isRecord(raw.seeding) && typeof raw.seeding.startedAt === "number") base.seeding = { startedAt: raw.seeding.startedAt };
  if (raw.seeded === true) base.seeded = true;
  if (isRecord(raw.seedIncomplete) && typeof raw.seedIncomplete.code === "string") base.seedIncomplete = { code: raw.seedIncomplete.code };
  if (isRecord(raw.lost) && (raw.lost.reason === "missing" || raw.lost.reason === "corrupt" || raw.lost.reason === "future")) base.lost = { reason: raw.lost.reason };
}

/** Shape check of a persisted record (own fields only; unknown extra keys are dropped). */
function parseData(teamId: string, text: string): { ok: true; data: SidecarData } | { ok: false; reason: "corrupt" | "future" } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "corrupt" };
  }
  if (!isRecord(raw)) return { ok: false, reason: "corrupt" };
  if (typeof raw.schemaVersion === "number" && raw.schemaVersion > SIDECAR_SCHEMA_VERSION) return { ok: false, reason: "future" };
  const headerOk = raw.schemaVersion === SIDECAR_SCHEMA_VERSION && raw.teamId === teamId && (raw.kind === "group" || raw.kind === "apply") && typeof raw.goal === "string" && typeof raw.repo === "string";
  if (!headerOk) return { ok: false, reason: "corrupt" };
  const base = emptyData({ teamId, kind: raw.kind as OpenspecProfileKind, goal: raw.goal as string, repo: raw.repo as string });
  for (const key of MAP_FIELDS) {
    if (raw[key] === undefined) continue;
    if (!isRecord(raw[key])) return { ok: false, reason: "corrupt" };
    (base as unknown as Record<string, unknown>)[key] = raw[key];
  }
  copyMarkers(raw, base);
  return { ok: true, data: base };
}

/** Atomic write of `data` (temp file + rename); a failed write leaves the previous file and no temp file. */
function writeAtomic(io: SidecarFs, dir: string, data: SidecarData): { ok: true } | { ok: false; message: string } {
  const file = path.join(dir, `${data.teamId}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    io.mkdir(dir);
    io.writeFile(tmp, JSON.stringify(data));
    io.rename(tmp, file);
    return { ok: true };
  } catch (err) {
    try {
      io.unlink(tmp);
    } catch {
      // best effort: a leftover .tmp is ignored by load()
    }
    return { ok: false, message: (err as Error).message };
  }
}

/** `*.json` file names of the sidecar directory (`.tmp`, `.corrupt`, `.future` are never listed); `[]` when it does not exist yet. */
function jsonFiles(io: SidecarFs, dir: string): string[] {
  try {
    return io.readdir(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
}

/** Read and parse every sidecar file into `cache`; the report names unusable files. */
function loadFiles(io: SidecarFs, dir: string, cache: Map<string, SidecarData>): LoadReport {
  const report: LoadReport = { loaded: [], corrupt: [], future: [] };
  for (const name of jsonFiles(io, dir)) {
    const teamId = name.slice(0, -".json".length);
    if (!TEAM_ID_RE.test(teamId)) continue;
    let text: string;
    try {
      text = io.readFile(path.join(dir, name));
    } catch {
      report.corrupt.push(teamId);
      continue;
    }
    const parsed = parseData(teamId, text);
    if (parsed.ok) {
      cache.set(teamId, parsed.data);
      report.loaded.push(teamId);
    } else (parsed.reason === "future" ? report.future : report.corrupt).push(teamId);
  }
  return report;
}

export function createSidecarStore(opts: { dir: string; logger: Logger; fs?: SidecarFs }): SidecarStore {
  const { dir, logger } = opts;
  const io = opts.fs ?? nodeSidecarFs;
  const cache = new Map<string, SidecarData>();
  let writes = 0;
  const fileOf = (teamId: string): string => path.join(dir, `${teamId}.json`);
  const validId = (teamId: string): boolean => TEAM_ID_RE.test(teamId);

  function persist(data: SidecarData): { ok: true } | { ok: false; message: string } {
    const res = writeAtomic(io, dir, data);
    if (res.ok) writes++;
    return res;
  }

  const missing = (teamId: string): SidecarResult<never> => ({ ok: false, error: "sidecar_missing", message: `no sidecar for team ${teamId}` });
  const writeFailed = (message: string): SidecarResult<never> => ({ ok: false, error: "sidecar_write_failed", message });

  /** Drop cached records of dead teams, then unreadable files (never loaded) of teams that no longer exist. */
  function pruneAll(isLive: (teamId: string) => boolean): number {
    let n = 0;
    for (const teamId of [...cache.keys()]) {
      if (isLive(teamId)) continue;
      store.remove(teamId);
      n++;
    }
    for (const name of jsonFiles(io, dir)) {
      const teamId = name.slice(0, -".json".length);
      if (cache.has(teamId) || !validId(teamId) || isLive(teamId)) continue;
      try {
        io.unlink(path.join(dir, name));
        n++;
      } catch {
        // leave it
      }
    }
    return n;
  }

  const store: SidecarStore = {
    dir,
    get writes() {
      return writes;
    },
    load: () => loadFiles(io, dir, cache),
    has: (teamId) => cache.has(teamId),
    state(teamId) {
      const d = cache.get(teamId);
      return d ? (d.lost ? "lost" : "ok") : "absent";
    },
    get: (teamId) => cache.get(teamId),
    ids: () => [...cache.keys()],
    create(init, mutate) {
      if (!validId(init.teamId)) return writeFailed("invalid team id");
      // Only when absent: an existing record is returned untouched, the mutator never runs (a second seed call must not rewrite it).
      const existing = cache.get(init.teamId);
      if (existing) return { ok: true, data: existing };
      const draft = emptyData(init);
      mutate?.(draft);
      const res = persist(draft);
      if (!res.ok) return writeFailed(res.message);
      cache.set(init.teamId, draft);
      return { ok: true, data: draft };
    },
    update(teamId, mutate) {
      const cur = cache.get(teamId);
      if (!cur) return missing(teamId);
      const draft = structuredClone(cur);
      mutate(draft);
      draft.schemaVersion = SIDECAR_SCHEMA_VERSION;
      draft.teamId = teamId;
      const res = persist(draft);
      if (!res.ok) return writeFailed(res.message);
      cache.set(teamId, draft);
      return { ok: true, data: draft };
    },
    markLost(init, reason) {
      if (!validId(init.teamId)) return writeFailed("invalid team id");
      if (reason !== "missing") {
        try {
          io.rename(fileOf(init.teamId), `${fileOf(init.teamId)}.${reason}`);
        } catch (err) {
          logger.warn(`agent-teams: openspec sidecar of team ${init.teamId} could not be set aside: ${(err as Error).message}`);
        }
      }
      const draft = emptyData(init);
      draft.lost = { reason };
      draft.noticed.sidecar_missing = true;
      const res = persist(draft);
      if (!res.ok) return writeFailed(res.message);
      cache.set(init.teamId, draft);
      return { ok: true, data: draft };
    },
    noticeOnce(teamId, key) {
      const cur = cache.get(teamId);
      if (!cur || cur.noticed[key]) return false;
      return store.update(teamId, (d) => void (d.noticed[key] = true)).ok;
    },
    remove(teamId) {
      cache.delete(teamId);
      if (!validId(teamId)) return;
      try {
        io.unlink(fileOf(teamId));
      } catch {
        // already gone
      }
    },
    prune(isLive, hydrated) {
      return hydrated ? pruneAll(isLive) : 0;
    },
  };
  return store;
}

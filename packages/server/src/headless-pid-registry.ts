/**
 * Registry mapping headless child processes to session IDs.
 * Tracks PID + cwd at spawn time, links to sessionId when the bridge connects.
 * Persists entries to disk so a restarted server can clean up orphans.
 */
import type { ChildProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { EventEmitter } from "node:events";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { killPidWithGroup, isProcessAlive, killProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import path from "node:path";
import os from "node:os";
import { isUnsafeTestHomeScan } from "./test-env-guard.js";

/**
 * Minimal interface the registry depends on for keeper-mediated writes
 * and orphan reconciliation. Implemented by `KeeperManager` in
 * `rpc-keeper/keeper-manager.ts`. Injected via
 * `HeadlessPidRegistryOptions.keeperManager` to avoid a circular dep at
 * module load. See change: add-rpc-stdin-dispatch-with-keeper-sidecar (Phase 6).
 */
export interface KeeperWriter {
  writeRpcToSockPath(sockPath: string, line: string): Promise<boolean>;
  discoverExistingKeepers(): Promise<Array<{ sessionId: string; keeperPid: number; sockPath: string }>>;
}

/** Default PID file path */
const DEFAULT_PID_FILE = path.join(os.homedir(), ".pi", "dashboard", "headless-pids.json");

/** Max age before an orphan is killed (7 days) */
const MAX_ORPHAN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface HeadlessEntry {
  pid: number;
  cwd: string;
  process: ChildProcess;
  sessionId?: string;
  spawnedAt: number;
  /**
   * Server-minted spawn correlation token. Stored at `register` time.
   * Used by `linkByToken` (tier 1) to resolve sessionId↔pid mapping
   * deterministically, replacing the racy cwd-FIFO `linkSession`.
   * See change: spawn-correlation-token.
   */
  spawnToken?: string;
  /**
   * Pi process PID, distinct from the spawn-time PID when an RPC keeper
   * sidecar owns pi's stdin (see `rpc-keeper-sidecar`). Set by
   * `linkByToken` from `session_register.pid` once the bridge connects.
   * In non-keeper mode it remains undefined; consumers fall back to
   * `entry.pid`. See change: add-rpc-stdin-dispatch-with-keeper-sidecar.
   */
  piPid?: number;
  /**
   * RPC keeper sidecar PID. Set at register-time when the entry was
   * spawned through `spawnHeadlessViaKeeper`. In keeper mode this equals
   * `entry.pid` (the keeper IS the spawned child); the explicit field
   * makes the keeper-vs-non-keeper branch unambiguous in `killBySessionId`
   * and `writeRpc`. See change: add-rpc-stdin-dispatch-with-keeper-sidecar.
   */
  keeperPid?: number;
  /**
   * Absolute UDS / named-pipe path the keeper listens on. Set at
   * register-time alongside `keeperPid`. Used by `writeRpc` to forward
   * `dispatch_extension_command` lines without re-deriving the path.
   */
  keeperSockPath?: string;
}

/**
 * Serialized format for disk persistence. ALL identity-bearing fields
 * must round-trip across server restart so `linkByToken` / `linkByPid`
 * keep their precise matching after `cleanupOrphans` reclaims entries.
 *
 * Without this, after a dashboard restart the rebuilt entry only has
 * (pid, cwd, spawnedAt). The bridge then re-registers with
 * `{pid: piPid, spawnToken: <omitted-on-reattach>}` and the registry
 * falls all the way through to the cwd-FIFO tier, which mis-maps
 * sessionIds to keeper entries when two sessions share a cwd. Symptom:
 * `/ctx-stats` in session A dispatches to pi-B's keeper; killing A
 * SIGTERMs B's pi. See change: add-rpc-stdin-dispatch-with-keeper-sidecar.
 */
interface PersistedEntry {
  pid: number;
  cwd: string;
  spawnedAt: string;
  spawnToken?: string;
  piPid?: number;
  keeperPid?: number;
  keeperSockPath?: string;
}

interface PidFileData {
  entries: PersistedEntry[];
}

export interface KeeperRegisterOptions {
  keeperPid: number;
  keeperSockPath: string;
}

/**
 * Pure helper: derive the optional `KeeperRegisterOptions` from a
 * SpawnResult-shaped object. Returns `undefined` when the spawn was not
 * keeper-mediated (no `keeperSockPath`). Lets registration call sites
 * stay one-liners across all spawn paths.
 * See change: add-rpc-stdin-dispatch-with-keeper-sidecar.
 */
export function keeperOptsFromSpawnResult(
  result: { pid?: number; keeperSockPath?: string },
): KeeperRegisterOptions | undefined {
  if (typeof result.pid !== "number" || !result.keeperSockPath) return undefined;
  return { keeperPid: result.pid, keeperSockPath: result.keeperSockPath };
}

export interface HeadlessPidRegistry {
  /**
   * Register a newly spawned headless process. The optional `spawnToken`
   * is the server-minted UUID injected into the spawned process's env;
   * storing it lets `linkByToken` resolve identity precisely later.
   * The optional `keeperOpts` marks this entry as keeper-mediated and
   * stores the keeper PID + socket path for `writeRpc` / `killBySessionId`.
   * See change: spawn-correlation-token, add-rpc-stdin-dispatch-with-keeper-sidecar.
   */
  register(
    pid: number,
    cwd: string,
    proc: ChildProcess,
    spawnToken?: string,
    keeperOpts?: KeeperRegisterOptions,
  ): void;
  /**
   * Tier 1 link: find entry by `spawnToken`, set its `sessionId`. Returns
   * `true` on match. The strongest identity — used when the bridge sent
   * `session_register.spawnToken`. When `pid` is provided AND the entry
   * is keeper-mediated, `entry.piPid` is set so `killBySessionId` can
   * SIGTERM pi directly (the keeper auto-exits on pi exit). See change:
   * spawn-correlation-token, add-rpc-stdin-dispatch-with-keeper-sidecar.
   */
  linkByToken(spawnToken: string, sessionId: string, pid?: number): boolean;
  /**
   * Tier 2 link: find entry by `pid` (where `!sessionId`), set its
   * `sessionId`. Returns `true` on match. Used when the bridge sent
   * `session_register.pid` but no token. See change: spawn-correlation-token.
   */
  linkByPid(sessionId: string, pid: number): boolean;
  /**
   * Tier 3 (legacy) link: find first entry by `cwd` where `!sessionId`,
   * set its `sessionId`. Returns `true` on match. Cwd-FIFO fallback for
   * old bridges that send neither token nor pid. Race-prone for
   * concurrent same-cwd spawns; tiers 1–2 should pre-empt this.
   */
  linkSession(sessionId: string, cwd: string): boolean;
  /**
   * Get the PID linked to a session ID. In keeper mode returns the pi
   * PID once linked (`entry.piPid`), falling back to `entry.pid` (= keeper
   * PID at spawn) if the bridge hasn't connected yet. In non-keeper mode
   * returns `entry.pid` unchanged.
   */
  getPid(sessionId: string): number | undefined;
  /**
   * Terminate the process linked to a session ID with SIGTERM → 2 s →
   * SIGKILL escalation via the shared `killProcess` ladder. Returns true
   * if at least one kill targeted a live PID. In keeper mode kills pi
   * first (so the keeper's auto-exit-on-pi-exit fires) and schedules a
   * fallback SIGTERM to the keeper after a brief delay if it survives.
   * See change: add-rpc-stdin-dispatch-with-keeper-sidecar; escalation
   * added in change: fix-keeper-kill-escalation.
   */
  killBySessionId(sessionId: string): Promise<boolean>;
  /**
   * Terminate the process for the entry whose stored `spawnToken` matches,
   * using the same SIGTERM → 2 s → SIGKILL ladder as `killBySessionId`
   * (keeper-aware: kills pi first). Enables killing a spawned-but-not-yet-
   * registered run — one with no `sessionId` linked — by process handle.
   * Returns true if at least one kill targeted a live PID; false for an
   * unknown token or an already-dead pid. See change:
   * fix-automation-stop-zombie-runs.
   */
  killByToken(spawnToken: string): Promise<boolean>;
  /** Remove a tracked process by PID. */
  remove(pid: number): void;
  /** Kill all tracked processes (for server shutdown). */
  killAll(): void;
  /** Number of tracked entries (for testing). */
  size(): number;
  /** Clean up orphan processes from a previous server instance. */
  cleanupOrphans(): Promise<void>;
  /**
   * Connect to the keeper UDS for `sessionId` and write `line + \n`.
   * Returns false if no entry, no keeper for this session, or if the
   * 3-attempt write to the socket fails. Never throws. Used by the
   * server's dispatch handler to forward extension slash commands to pi.
   * See change: add-rpc-stdin-dispatch-with-keeper-sidecar (Phase 6/8).
   */
  writeRpc(sessionId: string, line: string): Promise<boolean>;
  /**
   * Async startup pass: scan the sessions dir for live keeper sidecars
   * (via the injected `KeeperManager.discoverExistingKeepers`) and
   * reconcile them with the in-memory registry. Live keepers whose
   * registry entry doesn't yet exist are skipped (the bridge will
   * register them on connect). No-op when no `keeperManager` was injected.
   * See change: add-rpc-stdin-dispatch-with-keeper-sidecar (Phase 6).
   */
  cleanupKeeperOrphans(): Promise<void>;
  /**
   * Inject the keeper writer / discoverer after construction. Necessary
   * because `browser-gateway.ts` constructs the registry before the
   * server creates the `KeeperManager`. Pass `null` to clear (used by tests).
   */
  setKeeperWriter(writer: KeeperWriter | null): void;
}

export interface HeadlessPidRegistryOptions {
  pidFilePath?: string;
  /**
   * Optional `KeeperWriter` (typically a `KeeperManager`) wired so the
   * registry can delegate UDS writes and orphan reconciliation. May be
   * supplied after construction via `setKeeperWriter` instead.
   * See change: add-rpc-stdin-dispatch-with-keeper-sidecar (Phase 6).
   */
  keeperManager?: KeeperWriter;
}

export function createHeadlessPidRegistry(options?: HeadlessPidRegistryOptions): HeadlessPidRegistry {
  const entries = new Map<number, HeadlessEntry>();
  const pidFilePath = options?.pidFilePath ?? DEFAULT_PID_FILE;
  let keeperWriter: KeeperWriter | null = options?.keeperManager ?? null;

  /** Internal: locate entry by sessionId. */
  function findBySessionId(sessionId: string): HeadlessEntry | undefined {
    for (const entry of entries.values()) {
      if (entry.sessionId === sessionId) return entry;
    }
    return undefined;
  }

  /** Internal: locate entry by stored spawnToken. */
  function findByToken(spawnToken: string): HeadlessEntry | undefined {
    for (const entry of entries.values()) {
      if (entry.spawnToken === spawnToken) return entry;
    }
    return undefined;
  }

  /**
   * Internal: run the SIGTERM → 2 s → SIGKILL kill ladder for one entry.
   * Keeper-aware — kills pi first so the keeper's auto-exit fires, with a
   * fallback SIGTERM to the keeper. Shared by `killBySessionId` /
   * `killByToken`. Returns true if a live PID was targeted.
   */
  async function killEntry(entry: HeadlessEntry): Promise<boolean> {
    // Keeper-mediated entry: kill pi first (with SIGTERM → 2 s →
    // SIGKILL escalation) so the keeper's auto-exit-on-pi-exit handler
    // fires; schedule a fallback SIGTERM to the keeper if it survives
    // the brief grace window.
    // See change: add-rpc-stdin-dispatch-with-keeper-sidecar (task 6.4);
    // SIGKILL escalation added in change: fix-keeper-kill-escalation.
    if (entry.keeperPid !== undefined) {
      const piPid = entry.piPid;
      const keeperPid = entry.keeperPid;
      let killedSomething = false;
      if (piPid !== undefined) {
        try {
          await killProcess(piPid, { timeoutMs: 2000 });
          killedSomething = true;
        } catch { /* pi may already be dead */ }
      }
      // Fallback: 200 ms grace for the keeper's auto-exit; SIGTERM if it
      // survives. Fire-and-forget — the keeper's own SIGTERM handler is
      // reliable on the happy path, and Decision 3 of
      // fix-keeper-kill-escalation has the keeper SIGKILL its piChild on
      // shutdown, so registry-level SIGKILL escalation here is unneeded.
      setTimeout(() => {
        if (isProcessAlive(keeperPid)) {
          try { killPidWithGroup(keeperPid, "SIGTERM"); } catch { /* ignore */ }
        }
      }, 200).unref?.();
      // If pi was unknown (bridge never connected), fall through to
      // killing the keeper directly with SIGKILL escalation so the
      // spawn cleanup completes — we have no cleaner shutdown signal.
      if (!killedSomething) {
        try {
          await killProcess(keeperPid, { timeoutMs: 2000 });
          killedSomething = true;
        } catch { /* ignore */ }
      }
      entries.delete(entry.pid);
      persist();
      return killedSomething;
    }

    // Non-keeper path (legacy): kill the spawn-time PID directly with
    // SIGTERM → 2 s → SIGKILL escalation (uniform with keeper path).
    // Returns true once the kill is ISSUED for a known entry (matches the
    // established killBySessionId contract; a non-throwing killProcess —
    // even {ok:false} for an already-dead PID — counts as issued).
    try {
      await killProcess(entry.pid, { timeoutMs: 2000 });
      entries.delete(entry.pid);
      persist();
      return true;
    } catch {
      entries.delete(entry.pid);
      persist();
      return false;
    }
  }

  function persist() {
    const data: PidFileData = {
      entries: [...entries.values()].map((e) => {
        const out: PersistedEntry = {
          pid: e.pid,
          cwd: e.cwd,
          spawnedAt: new Date(e.spawnedAt).toISOString(),
        };
        if (e.spawnToken) out.spawnToken = e.spawnToken;
        if (e.piPid !== undefined) out.piPid = e.piPid;
        if (e.keeperPid !== undefined) out.keeperPid = e.keeperPid;
        if (e.keeperSockPath) out.keeperSockPath = e.keeperSockPath;
        return out;
      }),
    };
    try {
      writeJsonFile(pidFilePath, data);
    } catch {
      // Non-fatal — persistence is best-effort
    }
  }

  function loadFromDisk(): PersistedEntry[] {
    const data = readJsonFile<PidFileData>(pidFilePath, { entries: [] });
    return data.entries ?? [];
  }

  return {
    register(
      pid: number,
      cwd: string,
      proc: ChildProcess,
      spawnToken?: string,
      keeperOpts?: KeeperRegisterOptions,
    ) {
      const entry: HeadlessEntry = {
        pid,
        cwd,
        process: proc,
        spawnedAt: Date.now(),
        spawnToken,
      };
      if (keeperOpts) {
        entry.keeperPid = keeperOpts.keeperPid;
        entry.keeperSockPath = keeperOpts.keeperSockPath;
      }
      entries.set(pid, entry);
      proc.on("exit", () => {
        entries.delete(pid);
        persist();
      });
      persist();
    },

    linkByToken(spawnToken: string, sessionId: string, pid?: number): boolean {
      if (!spawnToken) return false;
      for (const entry of entries.values()) {
        if (entry.spawnToken === spawnToken && !entry.sessionId) {
          entry.sessionId = sessionId;
          // Keeper-mode: store pi's PID separately so killBySessionId can
          // SIGTERM pi directly (the keeper auto-exits on pi exit).
          // Non-keeper mode leaves piPid undefined; getPid falls back to
          // entry.pid. See change: add-rpc-stdin-dispatch-with-keeper-sidecar.
          if (entry.keeperPid !== undefined && pid !== undefined && pid !== entry.pid) {
            entry.piPid = pid;
            // Persist immediately so a future cleanupOrphans reclaim has
            // piPid available for linkByPid to match against (the token
            // is omitted by the bridge on reattach).
            persist();
          }
          return true;
        }
      }
      return false;
    },

    linkByPid(sessionId: string, pid: number): boolean {
      // Tier 2a: match by Map key (= spawn-time pid). Always tried first
      // because it's O(1) and exact for non-keeper mode.
      const direct = entries.get(pid);
      if (direct && !direct.sessionId) {
        direct.sessionId = sessionId;
        return true;
      }
      // Tier 2b: keeper-mode reattach. After server restart, the Map is
      // keyed by `keeperPid` (the spawn-time pid in keeper mode); pi's
      // actual PID lives in `entry.piPid`. The bridge's session_register
      // sends pi's PID, so direct Map lookup misses. Iterate to find a
      // matching piPid — critical for correct sessionId↔pi mapping when
      // multiple sessions share a cwd (otherwise the cwd-FIFO fallback
      // mis-maps and `/ctx-stats` dispatches to the wrong keeper).
      // See change: add-rpc-stdin-dispatch-with-keeper-sidecar.
      for (const entry of entries.values()) {
        if (entry.piPid === pid && !entry.sessionId) {
          entry.sessionId = sessionId;
          return true;
        }
      }
      return false;
    },

    linkSession(sessionId: string, cwd: string): boolean {
      for (const entry of entries.values()) {
        if (entry.cwd === cwd && !entry.sessionId) {
          entry.sessionId = sessionId;
          return true;
        }
      }
      return false;
    },

    getPid(sessionId: string): number | undefined {
      const entry = findBySessionId(sessionId);
      if (!entry) return undefined;
      // Keeper mode: prefer the linked pi PID; fall back to entry.pid (=
      // keeper PID) when the bridge hasn't connected yet. Non-keeper mode
      // returns entry.pid unchanged.
      // See change: add-rpc-stdin-dispatch-with-keeper-sidecar.
      return entry.piPid ?? entry.pid;
    },

    async killBySessionId(sessionId: string): Promise<boolean> {
      const entry = findBySessionId(sessionId);
      if (!entry) return false;
      return killEntry(entry);
    },

    async killByToken(spawnToken: string): Promise<boolean> {
      if (!spawnToken) return false;
      const entry = findByToken(spawnToken);
      if (!entry) return false;
      return killEntry(entry);
    },

    remove(pid: number) {
      entries.delete(pid);
      persist();
    },

    killAll() {
      if (isUnsafeTestHomeScan()) {
        console.warn("[headless-pid-registry] killAll() blocked: running under vitest with real HOME");
        return;
      }
      for (const [pid] of entries) {
        try {
          killPidWithGroup(pid, "SIGTERM");
        } catch {
          // Process may have already exited
        }
      }
      entries.clear();
      // Don't persist here — keep disk entries so cleanupOrphans() can
      // reclaim surviving processes after a server restart.
    },

    size() {
      return entries.size;
    },

    setKeeperWriter(writer: KeeperWriter | null) {
      keeperWriter = writer;
    },

    async writeRpc(sessionId: string, line: string): Promise<boolean> {
      const entry = findBySessionId(sessionId);
      if (!entry || !entry.keeperSockPath || !keeperWriter) return false;
      return keeperWriter.writeRpcToSockPath(entry.keeperSockPath, line);
    },

    async cleanupKeeperOrphans(): Promise<void> {
      if (isUnsafeTestHomeScan()) {
        console.warn("[headless-pid-registry] cleanupKeeperOrphans() blocked: running under vitest with real HOME");
        return;
      }
      if (!keeperWriter) return;
      // KeeperManager.discoverExistingKeepers does the heavy lifting:
      // unlinks stale sockets, SIGTERMs orphans whose pi child is dead.
      // The registry only needs to know about live pairs so it can
      // attach keeper info to existing entries (matched by spawn-time
      // pid via the persisted sidecar PID).
      try {
        const live = await keeperWriter.discoverExistingKeepers();
        for (const k of live) {
          // Reattach to any existing entry whose spawn-time PID matches
          // the keeper PID (set when the previous server instance ran
          // spawnHeadlessViaKeeper). Defensive: do not blow away entries
          // that already have keeperPid set.
          const existing = entries.get(k.keeperPid);
          if (existing && existing.keeperPid === undefined) {
            existing.keeperPid = k.keeperPid;
            existing.keeperSockPath = k.sockPath;
            persist();
          }
        }
      } catch (err) {
        console.warn("[headless-pid-registry] cleanupKeeperOrphans failed", err);
      }
    },

    async cleanupOrphans(): Promise<void> {
      if (isUnsafeTestHomeScan()) {
        console.warn("[headless-pid-registry] cleanupOrphans() blocked: running under vitest with real HOME");
        return;
      }
      const persisted = loadFromDisk();
      const now = Date.now();

      for (const entry of persisted) {
        const spawnedAt = new Date(entry.spawnedAt).getTime();
        const age = now - spawnedAt;

        if (!isProcessAlive(entry.pid)) {
          // Dead process — skip (will be removed from file on persist)
          continue;
        }

        if (age > MAX_ORPHAN_AGE_MS) {
          // Very old orphan — escalate via SIGTERM → 2 s → SIGKILL ladder
          // (uniform with killBySessionId after change:
          // fix-keeper-kill-escalation).
          try {
            await killProcess(entry.pid, { timeoutMs: 2000 });
          } catch {
            // Already dead
          }
          continue;
        }

        // Alive and not too old — reclaim into registry.
        // ALL identity fields are restored so the post-restart three-tier
        // link (token → pid → cwd-FIFO) keeps its precision; without piPid
        // / spawnToken, keeper-mode sessions mis-map under cwd-FIFO when
        // two sessions share a cwd. See change:
        // add-rpc-stdin-dispatch-with-keeper-sidecar.
        const dummyProc = new EventEmitter() as ChildProcess;
        const reclaimed: HeadlessEntry = {
          pid: entry.pid,
          cwd: entry.cwd,
          process: dummyProc,
          spawnedAt,
        };
        if (entry.spawnToken) reclaimed.spawnToken = entry.spawnToken;
        if (entry.piPid !== undefined) reclaimed.piPid = entry.piPid;
        if (entry.keeperPid !== undefined) reclaimed.keeperPid = entry.keeperPid;
        if (entry.keeperSockPath) reclaimed.keeperSockPath = entry.keeperSockPath;
        entries.set(entry.pid, reclaimed);
      }

      persist();
    },
  };
}

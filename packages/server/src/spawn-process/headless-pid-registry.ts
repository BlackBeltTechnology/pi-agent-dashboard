/**
 * Registry mapping headless child processes to session IDs.
 * Tracks PID + cwd at spawn time, links to sessionId when the bridge connects.
 * Persists entries to disk so a restarted server can clean up orphans.
 */

import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import type { ExitIntent } from "@blackbelt-technology/pi-dashboard-shared/boot-state.js";
import type { ChildProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import {
  killPidWithGroup,
  killProcess,
  killProcessGroup,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { isUnsafeTestHomeScan } from "../auth/test-env-guard.js";
import { readJsonFile, writeJsonFile } from "../persistence/json-store.js";
import {
  type IdentityKind,
  type IdentityVerdict,
  identityLogLine,
  KILL_ALL_VERIFY_BUDGET_MS,
  LEGACY_PI_WINDOW_MS,
  parseAnchor,
  type StartProbe,
  verifyRestored,
} from "./restored-identity.js";

/**
 * Minimal interface the registry depends on for orphan reconciliation.
 * Implemented by `KeeperManager` in `rpc-keeper/keeper-manager.ts`. Injected
 * via `HeadlessPidRegistryOptions.keeperManager` to avoid a circular dep at
 * module load. See change: add-rpc-stdin-dispatch-with-keeper-sidecar (Phase 6).
 */
export interface KeeperWriter {
  /**
   * `piPid` is optional and present only when the keeper's pi-PID sidecar named
   * a live process. Kept optional so structurally-compatible test fakes stay
   * valid under return covariance. See change: fix-keeper-session-identity-and-reattach.
   */
  discoverExistingKeepers(): Promise<
    Array<{ sessionId: string; keeperPid: number; sockPath: string; piPid?: number; piPidAnchorMs?: number }>
  >;
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
   * makes the keeper-vs-non-keeper branch unambiguous in `killBySessionId`.
   * See change: add-rpc-stdin-dispatch-with-keeper-sidecar.
   */
  keeperPid?: number;
  /**
   * Absolute UDS / named-pipe path the keeper listens on. Set at
   * register-time alongside `keeperPid`. Retained as keeper bookkeeping
   * (`hasKeeper`, cleanup reconciliation) — no server-side RPC line is
   * written for `dispatch_extension_command` since change
   * `retire-slash-dispatch-via-expand-prompt-templates`.
   */
  keeperSockPath?: string;
  /**
   * Opaque plugin-ownership ref promoted onto the linked entry once a session
   * registers with its spawn token (resolved from the token-keyed pending
   * store). Round-trips across restart so a keeper-respawned session reaches
   * its existing owner via the persisted entry, not the consumed token.
   * Replaces the automation/goal-specific `goalId` field.
   * See change: detach-automation-goal-from-core.
   */
  pluginRef?: Record<string, unknown>;
  /**
   * Epoch ms at which `piPid` was proven live: `linkByToken` time, or the
   * verified pi-PID sidecar mtime. Persisted. `NaN` when a persisted value was
   * unparseable (⇒ unverifiable). See change: guard-restored-headless-identity.
   */
  piLinkedAt?: number;
  /** Set only by `cleanupOrphans`: no live handle, so every signal is verified. Not persisted. */
  restored?: boolean;
  /** Restored spawn-time pid failed verification: never signalled. Not persisted. */
  identityRefused?: boolean;
}

/** Outcome of a checked registry kill (design D1/D4). */
export interface CheckedKillResult {
  outcome: "signalled" | "no-entry" | "refused-identity";
  /** Pids the registry refused to signal (mismatch, refused, or unverifiable when unattended). */
  refusedPids: number[];
  /** Human-readable reason when a pid was refused. */
  diagnostic?: string;
  /** Legacy `killBySessionId` boolean: a kill was issued. */
  killed: boolean;
}

/** `verifyIdentity: true` (default) = unattended: an unverifiable restored pid is refused. */
type VerifyIdentityOption = { verifyIdentity?: boolean };

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
  piLinkedAt?: string;
  keeperPid?: number;
  keeperSockPath?: string;
  pluginRef?: Record<string, unknown>;
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
   * stores the keeper PID + socket path for `killBySessionId`.
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
   * Resolve the opaque `pluginRef` for a linked session (promoted onto the
   * entry at resolve time). Returns `undefined` for an unowned session.
   * See change: detach-automation-goal-from-core.
   */
  getPluginRef(sessionId: string): Record<string, unknown> | undefined;
  /**
   * Promote a resolved `pluginRef` onto the entry linked to `sessionId` so it
   * persists across restart / keeper respawn. Returns `true` when an entry
   * matched. See change: detach-automation-goal-from-core.
   */
  setPluginRef(sessionId: string, pluginRef: Record<string, unknown>): boolean;
  /**
   * Keeper-respawn relink: a keeper (stable `keeperPid`) relaunched pi with a
   * new sessionId + new pi pid + no token. Relink the persisted keeper entry
   * to the new sessionId and refresh the stale `piPid`, so the respawned
   * session reaches its existing `pluginRef`. Relinks even an entry already
   * carrying a (now-dead) sessionId. Returns `true` on match. An in-process
   * fork has no keeper entry of its own and is unaffected (never inherits the
   * parent's ref). See change: detach-automation-goal-from-core.
   */
  relinkByKeeperPid(keeperPid: number, sessionId: string, piPid?: number): boolean;
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
  linkByPid(sessionId: string, pid: number, opts?: { cwd?: string }): boolean;
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
   * Checked session kill: every pid of a RESTORED entry is verified by start
   * time immediately before its first signal. `verifyIdentity` (default true =
   * unattended) refuses an unverifiable pid; a mismatch is refused always.
   * `killBySessionId` is this with `verifyIdentity:false`, reduced to `killed`.
   * See change: guard-restored-headless-identity (D1).
   */
  killBySessionIdChecked(sessionId: string, opts?: VerifyIdentityOption): Promise<CheckedKillResult>;
  /**
   * Operator pre-check for a pid about to be signalled outside the registry
   * (force-kill): `mismatch` when `pid` belongs to a restored entry and fails
   * verification (or is the refused spawn pid), `unverifiable` when its start
   * time cannot be determined, else `ok`. Never signals.
   */
  verifySessionPid(sessionId: string, pid: number): Promise<"ok" | "mismatch" | "unverifiable">;
  /**
   * Terminate the process for the entry whose stored `spawnToken` matches,
   * using the same SIGTERM → 2 s → SIGKILL ladder as `killBySessionId`
   * (keeper-aware: kills pi first). Enables killing a spawned-but-not-yet-
   * registered run — one with no `sessionId` linked — by process handle.
   * Returns true if at least one kill targeted a live PID; false for an
   * unknown token or an already-dead pid. See change:
   * fix-automation-stop-zombie-runs.
   */
  killByToken(spawnToken: string, opts?: VerifyIdentityOption): Promise<boolean>;
  /**
   * Enumerate every entry that has been linked to a session id, with the
   * resolved pi PID and whether a keeper UDS is available for it.
   *
   * Reload fan-outs need this: they used to iterate
   * `piGateway.getConnectedSessionIds()` only, so a headless session whose
   * bridge WebSocket died — exactly the session that most needs a reload —
   * was never targeted. `sessionManager` cannot substitute, because such a
   * session is stamped `ended` on WS close.
   * See change: fix-out-of-band-reload.
   */
  listSessions(): Array<{ sessionId: string; cwd: string; pid: number; hasKeeper: boolean }>;
  /** Remove a tracked process by PID. */
  remove(pid: number): void;
  /**
   * Kill all tracked processes (for server shutdown). Restored entries are
   * verified first (5 s total budget). An unverifiable restored entry is
   * signalled only for exit intent `shutdown` / `user-quit` / `restart`; a
   * null or absent intent is unattended. Never rejects.
   */
  killAll(opts?: { exitIntent?: ExitIntent | null }): Promise<void>;
  /** Number of tracked entries (for testing). */
  size(): number;
  /** Clean up orphan processes from a previous server instance. */
  cleanupOrphans(): Promise<void>;
  /**
   * Async startup pass: scan the sessions dir for live keeper sidecars
   * (via the injected `KeeperManager.discoverExistingKeepers`) and
   * reconcile them with the in-memory registry. Live keepers whose
   * registry entry doesn't yet exist are skipped (the bridge will
   * register them on connect). No-op when no `keeperManager` was injected.
   * See change: add-rpc-stdin-dispatch-with-keeper-sidecar (Phase 6).
   *
   * Returns the sessionIds of the keepers found alive (keeper PID + pi PID
   * both live) so the caller can gate cold-start recovery: a session with a
   * live reclaimed keeper was never lost and must NOT be offered for reopen.
   * Empty when the scan was skipped (no keeper writer / unsafe test HOME) or
   * no live keepers exist. See change: fix-recovery-offer-bridge-liveness-gate.
   */
  cleanupKeeperOrphans(): Promise<string[]>;
  /**
   * Inject the keeper discoverer after construction. Necessary because
   * `browser-gateway.ts` constructs the registry before the server creates
   * the `KeeperManager`. Pass `null` to clear (used by tests).
   */
  setKeeperWriter(writer: KeeperWriter | null): void;
}

export interface HeadlessPidRegistryOptions {
  pidFilePath?: string;
  /**
   * Optional `KeeperWriter` (typically a `KeeperManager`) wired so the
   * registry can delegate orphan reconciliation. May be supplied after
   * construction via `setKeeperWriter` instead.
   * See change: add-rpc-stdin-dispatch-with-keeper-sidecar (Phase 6).
   */
  keeperManager?: KeeperWriter;
  /** Start-time probe for restored pids (default: `processStartedAt`). */
  probe?: StartProbe;
  /** Gone check for restored pids (default: `signalZero === "esrch"`). */
  isGone?: (pid: number) => boolean;
}

const OPERATOR_EXIT_INTENTS: ReadonlySet<ExitIntent> = new Set(["shutdown", "user-quit", "restart"]);

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

  const probe = options?.probe;
  const isGone = options?.isGone;
  const verify = (pid: number, anchor: number | undefined) =>
    verifyRestored(pid, anchor, { probe, isGone });

  /** Anchor of an entry's `piPid` (design D2): `piLinkedAt`, else the legacy window. */
  function piAnchor(entry: HeadlessEntry): number | undefined {
    if (entry.piLinkedAt !== undefined) return entry.piLinkedAt;
    return entry.spawnedAt + LEGACY_PI_WINDOW_MS;
  }

  /**
   * Gate one pid of an entry immediately before its first signal (D4/D5).
   * Live entries are never probed. Returns what to do with the pid.
   */
  async function gate(
    entry: HeadlessEntry,
    pid: number,
    anchor: number | undefined,
    kind: IdentityKind,
    verifyIdentity: boolean,
  ): Promise<"signal" | "gone" | "mismatch" | "refuse"> {
    if (!entry.restored) return "signal";
    const v = await verify(pid, anchor);
    if (v === "match") return "signal";
    if (v === "gone") return "gone";
    if (v === "mismatch") {
      console.warn(identityLogLine("mismatch", pid, kind, entry.sessionId));
      return "mismatch";
    }
    console.warn(identityLogLine(verifyIdentity ? "unverifiable" : "unverifiable (operator: signalled)", pid, kind, entry.sessionId));
    return verifyIdentity ? "refuse" : "signal";
  }

  /**
   * Internal: run the SIGTERM → 2 s → SIGKILL kill ladder for one entry.
   * Keeper-aware — kills pi first so the keeper's auto-exit fires, with a
   * fallback SIGTERM to the keeper. Shared by `killBySessionId` /
   * `killByToken`. A RESTORED entry's pids are verified before their first
   * signal; a refused pid is never signalled, and an entry nothing could be
   * signalled for stays in the registry. See change: guard-restored-headless-identity.
   */
  async function killEntry(entry: HeadlessEntry, verifyIdentity: boolean): Promise<CheckedKillResult> {
    const refusedPids: number[] = [];
    let mismatch = false;
    const refused = (pid: number, v: "mismatch" | "refuse") => {
      refusedPids.push(pid);
      if (v === "mismatch") mismatch = true;
    };
    const finish = (killed: boolean, anySignal: boolean): CheckedKillResult => {
      const outcome = !anySignal && refusedPids.length > 0 ? "refused-identity" : "signalled";
      if (outcome === "signalled" && entries.get(entry.pid) === entry) {
        entries.delete(entry.pid);
        persist();
      }
      const diagnostic = refusedPids.length === 0
        ? undefined
        : mismatch ? `identity reuse: pid ${refusedPids.join(",")} started after its anchor` : "identity unverifiable";
      return { outcome, refusedPids, killed: outcome === "signalled" && killed, ...(diagnostic ? { diagnostic } : {}) };
    };

    // Keeper-mediated entry: kill pi first (with SIGTERM → 2 s →
    // SIGKILL escalation) so the keeper's auto-exit-on-pi-exit handler
    // fires; schedule a fallback group kill of the keeper.
    // See change: add-rpc-stdin-dispatch-with-keeper-sidecar (task 6.4);
    // SIGKILL escalation added in change: fix-keeper-kill-escalation.
    if (entry.keeperPid !== undefined) {
      const keeperPid = entry.keeperPid;
      let killedSomething = false;
      let anySignal = false;
      const piPid = entry.piPid;
      if (piPid !== undefined) {
        const g = await gate(entry, piPid, piAnchor(entry), "pi", verifyIdentity);
        if (g === "signal") {
          anySignal = true;
          try {
            await killProcess(piPid, { timeoutMs: 2000 });
            killedSomething = true;
          } catch { /* pi may already be dead */ }
        } else if (g === "mismatch" || g === "refuse") {
          refused(piPid, g);
          // A mismatched piPid belongs to another process: forget it (D4).
          if (g === "mismatch" && entry.piPid === piPid) {
            entry.piPid = undefined;
            entry.piLinkedAt = undefined;
            persist();
          }
        }
      }
      // A refused keeper spawn pid is never signalled, not even as a group (G7).
      let keeperBlocked = entry.identityRefused === true;
      if (keeperBlocked) refused(keeperPid, "mismatch");
      // If pi was not signalled (bridge never connected, or refused), kill the
      // keeper directly with SIGKILL escalation so the spawn cleanup completes.
      if (!killedSomething && !keeperBlocked) {
        const g = await gate(entry, keeperPid, entry.spawnedAt, "keeper", verifyIdentity);
        if (g === "signal") {
          anySignal = true;
          try {
            await killProcess(keeperPid, { timeoutMs: 2000 });
            killedSomething = true;
          } catch { /* ignore */ }
        } else if (g === "mismatch" || g === "refuse") {
          refused(keeperPid, g);
          keeperBlocked = true;
        }
      }
      // Fallback after a 200 ms grace: terminate the keeper's whole process
      // GROUP (keeper + pi + pi's children — pi is spawned non-detached by the
      // keeper, so it shares the keeper's group). Gated on the GROUP still
      // existing, not on keeper liveness: the keeper auto-exits with pi, but
      // pi's orphaned children (long bash calls, MCP servers) stay in the
      // group. killProcessGroup is a no-op once the group is gone and
      // escalates SIGTERM → SIGKILL. See issue #912. A restored keeper pid is
      // re-probed when the timer fires (G3): mismatch skips, gone still reaps,
      // unverifiable follows the operator/unattended rule.
      if (!keeperBlocked && !(entry.restored && !anySignal && refusedPids.length > 0)) {
        const restored = entry.restored === true;
        const spawnedAt = entry.spawnedAt;
        const sessionId = entry.sessionId;
        setTimeout(() => {
          void (async () => {
            if (restored) {
              const v = await verify(keeperPid, spawnedAt);
              if (v === "mismatch" || (v === "unverifiable" && verifyIdentity)) {
                console.warn(identityLogLine(`${v} (group kill skipped)`, keeperPid, "keeper", sessionId));
                return;
              }
            }
            await killProcessGroup(keeperPid, { timeoutMs: 2000 });
          })().catch(() => undefined);
        }, 200).unref?.();
      }
      return finish(killedSomething, anySignal || !entry.restored || refusedPids.length === 0);
    }

    // Non-keeper path (legacy): kill the spawn-time PID directly with
    // SIGTERM → 2 s → SIGKILL escalation (uniform with keeper path).
    // Returns killed once the kill is ISSUED for a known entry (matches the
    // established killBySessionId contract; a non-throwing killProcess —
    // even {ok:false} for an already-dead PID — counts as issued).
    if (entry.identityRefused) {
      refused(entry.pid, "mismatch");
      return finish(false, false);
    }
    const g = await gate(entry, entry.pid, entry.spawnedAt, "spawn", verifyIdentity);
    if (g === "mismatch" || g === "refuse") {
      refused(entry.pid, g);
      return finish(false, false);
    }
    if (g === "gone") return finish(true, true);
    try {
      await killProcess(entry.pid, { timeoutMs: 2000 });
      return finish(true, true);
    } catch {
      return finish(false, true);
    }
  }

  function persist() {
    const data: PidFileData = {
      entries: [...entries.values()].map((e) => {
        const out: PersistedEntry = {
          pid: e.pid,
          cwd: e.cwd,
          // An unparseable restored anchor stays unparseable (⇒ unverifiable)
          // rather than throwing here. See change: guard-restored-headless-identity (G5).
          spawnedAt: Number.isFinite(e.spawnedAt) ? new Date(e.spawnedAt).toISOString() : "invalid-date",
        };
        if (e.spawnToken) out.spawnToken = e.spawnToken;
        if (e.piPid !== undefined) out.piPid = e.piPid;
        if (e.piPid !== undefined && e.piLinkedAt !== undefined && Number.isFinite(e.piLinkedAt)) {
          out.piLinkedAt = new Date(e.piLinkedAt).toISOString();
        }
        if (e.keeperPid !== undefined) out.keeperPid = e.keeperPid;
        if (e.keeperSockPath) out.keeperSockPath = e.keeperSockPath;
        if (e.pluginRef) out.pluginRef = e.pluginRef;
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
            // pi is alive and registering right now: the link time is the
            // identity anchor for this pid (no probe, no stamp race).
            // See change: guard-restored-headless-identity (D3).
            entry.piLinkedAt = Date.now();
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

    linkByPid(sessionId: string, pid: number, opts?: { cwd?: string }): boolean {
      // `opts.cwd`: an `unknown` pid target links by pid only to an entry in
      // the register's own cwd. See change: scope-pids-to-namespace (D3).
      // An identity-refused entry's pid belongs to another process: a pi that
      // merely holds that pid never owns it (G8). See change: guard-restored-headless-identity.
      const cwdOk = (e: HeadlessEntry) =>
        !e.identityRefused && (opts?.cwd === undefined || e.cwd === opts.cwd);
      // Tier 2a: match by Map key (= spawn-time pid). Always tried first
      // because it's O(1) and exact for non-keeper mode.
      const direct = entries.get(pid);
      if (direct && !direct.sessionId && cwdOk(direct)) {
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
        if (entry.piPid === pid && !entry.sessionId && cwdOk(entry)) {
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
          // Positional-resolution observability (HS-4): report ONLY when
          // cwd-FIFO — which matches on arrival order, not identity — resolved
          // a KEEPER-mode entry, i.e. positional matching decided a keeper
          // session's identity. Same keeper-mode predicate that gates capture
          // (Decision 2). A non-keeper match is silent. The line reports that a
          // keeper session was resolved positionally; it cannot say the
          // resolution was correct (nothing here knows the true owner).
          // See change: fix-keeper-session-identity-and-reattach (Decision 5).
          if (entry.keeperPid !== undefined) {
            console.error(
              `[keeper-identity] positional cwd-FIFO resolution session=${sessionId} cwd=${cwd} entryPid=${entry.pid}`,
            );
          }
          return true;
        }
      }
      return false;
    },

    getPluginRef(sessionId: string): Record<string, unknown> | undefined {
      return findBySessionId(sessionId)?.pluginRef;
    },

    setPluginRef(sessionId: string, pluginRef: Record<string, unknown>): boolean {
      const entry = findBySessionId(sessionId);
      if (!entry) return false;
      entry.pluginRef = pluginRef;
      persist();
      return true;
    },

    relinkByKeeperPid(keeperPid: number, sessionId: string, piPid?: number): boolean {
      for (const entry of entries.values()) {
        if (entry.keeperPid === keeperPid) {
          entry.sessionId = sessionId;
          if (piPid !== undefined) entry.piPid = piPid;
          persist();
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
      // Operator path: an unverifiable restored pid is signalled; a mismatch
      // is refused and reported as `false` (G2).
      return (await killEntry(entry, false)).killed;
    },

    async killBySessionIdChecked(sessionId: string, opts?: VerifyIdentityOption): Promise<CheckedKillResult> {
      const entry = findBySessionId(sessionId);
      if (!entry) return { outcome: "no-entry", refusedPids: [], killed: false };
      return killEntry(entry, opts?.verifyIdentity ?? true);
    },

    async verifySessionPid(sessionId: string, pid: number): Promise<"ok" | "mismatch" | "unverifiable"> {
      const entry = findBySessionId(sessionId);
      if (!entry?.restored) return "ok";
      let anchor: number | undefined;
      let kind: IdentityKind;
      if (pid === entry.piPid) {
        anchor = piAnchor(entry);
        kind = "pi";
      } else if (pid === entry.pid || pid === entry.keeperPid) {
        if (entry.identityRefused) return "mismatch";
        anchor = entry.spawnedAt;
        kind = entry.keeperPid !== undefined ? "keeper" : "spawn";
      } else {
        return "ok";
      }
      const v = await verify(pid, anchor);
      if (v === "mismatch" || v === "unverifiable") console.warn(identityLogLine(v, pid, kind, sessionId));
      return v === "mismatch" ? "mismatch" : v === "unverifiable" ? "unverifiable" : "ok";
    },

    async killByToken(spawnToken: string, opts?: VerifyIdentityOption): Promise<boolean> {
      if (!spawnToken) return false;
      const entry = findByToken(spawnToken);
      if (!entry) return false;
      // Token reclaims are unattended by default (D5).
      return (await killEntry(entry, opts?.verifyIdentity ?? true)).killed;
    },

    listSessions() {
      const out: Array<{ sessionId: string; cwd: string; pid: number; hasKeeper: boolean }> = [];
      for (const entry of entries.values()) {
        if (!entry.sessionId) continue;
        out.push({
          sessionId: entry.sessionId,
          cwd: entry.cwd,
          pid: entry.piPid ?? entry.pid,
          hasKeeper: Boolean(entry.keeperSockPath),
        });
      }
      return out;
    },

    remove(pid: number) {
      entries.delete(pid);
      persist();
    },

    async killAll(opts?: { exitIntent?: ExitIntent | null }): Promise<void> {
      if (isUnsafeTestHomeScan()) {
        console.warn("[headless-pid-registry] killAll() blocked: running under vitest with real HOME");
        return;
      }
      // A null or absent intent is unattended (G1): it never widens kill rights.
      const intent = opts?.exitIntent ?? null;
      const operator = intent !== null && OPERATOR_EXIT_INTENTS.has(intent);
      // Snapshot: only these entries are signalled and deleted (D7).
      const snapshot = [...entries.entries()];

      // Verify restored entries concurrently, under a total budget (G6). A
      // verdict that lands after the budget is ignored (⇒ unverifiable).
      // A restored keeper entry's `piPid` is verified too: when the keeper
      // group cannot be signalled, the pi rung alone runs (D4, G7).
      const verdicts = new Map<HeadlessEntry, IdentityVerdict>();
      const piVerdicts = new Map<HeadlessEntry, IdentityVerdict>();
      let settled = false;
      const restoredEntries = snapshot.filter(([, e]) => e.restored);
      const work = Promise.all([
        ...restoredEntries
          .filter(([, e]) => !e.identityRefused)
          .map(async ([pid, e]) => {
            const v = await verify(pid, e.spawnedAt).catch((): IdentityVerdict => "unverifiable");
            if (!settled) verdicts.set(e, v);
          }),
        ...restoredEntries
          .filter(([, e]) => e.keeperPid !== undefined && e.piPid !== undefined)
          .map(async ([, e]) => {
            const v = await verify(e.piPid as number, piAnchor(e)).catch((): IdentityVerdict => "unverifiable");
            if (!settled) piVerdicts.set(e, v);
          }),
      ]);
      let budgetTimer: ReturnType<typeof setTimeout> | undefined;
      const budget = new Promise<void>((resolve) => {
        budgetTimer = setTimeout(resolve, KILL_ALL_VERIFY_BUDGET_MS);
        budgetTimer.unref?.();
      });
      await Promise.race([work, budget]);
      settled = true;
      if (budgetTimer) clearTimeout(budgetTimer);

      const piKills: Array<Promise<unknown>> = [];
      for (const [pid, e] of snapshot) {
        let signal = true;
        if (e.identityRefused) {
          console.warn(identityLogLine("refused", pid, e.keeperPid !== undefined ? "keeper" : "spawn", e.sessionId));
          signal = false;
        } else if (e.restored) {
          const v = verdicts.get(e) ?? "unverifiable";
          const kind = e.keeperPid !== undefined ? "keeper" : "spawn";
          if (v === "gone") signal = false;
          else if (v === "mismatch") {
            console.warn(identityLogLine("mismatch", pid, kind, e.sessionId));
            signal = false;
          } else if (v === "unverifiable") {
            signal = operator;
            console.warn(identityLogLine(operator ? "unverifiable (operator: signalled)" : "unverifiable", pid, kind, e.sessionId));
          }
        }
        if (signal) {
          try {
            killPidWithGroup(pid, "SIGTERM");
          } catch {
            // Process may have already exited
          }
        } else if (e.keeperPid !== undefined && e.piPid !== undefined) {
          // Keeper group not signalled: the pi rung alone, never the keeper.
          const piPid = e.piPid;
          const v = piVerdicts.get(e) ?? "unverifiable";
          if (v === "match" || (v === "unverifiable" && operator)) {
            piKills.push(killProcess(piPid, { timeoutMs: 2000 }).catch(() => undefined));
          } else if (v !== "gone") {
            console.warn(identityLogLine(v, piPid, "pi", e.sessionId));
          }
        }
      }
      await Promise.all(piKills);
      for (const [pid, e] of snapshot) {
        if (entries.get(pid) === e) entries.delete(pid);
      }
      // Don't persist here — keep disk entries so cleanupOrphans() can
      // reclaim surviving processes after a server restart.
    },

    size() {
      return entries.size;
    },

    setKeeperWriter(writer: KeeperWriter | null) {
      keeperWriter = writer;
    },

    async cleanupKeeperOrphans(): Promise<string[]> {
      if (isUnsafeTestHomeScan()) {
        console.warn("[headless-pid-registry] cleanupKeeperOrphans() blocked: running under vitest with real HOME");
        return [];
      }
      if (!keeperWriter) return [];
      // KeeperManager.discoverExistingKeepers does the heavy lifting:
      // unlinks stale sockets, SIGTERMs orphans whose pi child is dead.
      // The registry only needs to know about live pairs so it can
      // attach keeper info to existing entries (matched by spawn-time
      // pid via the persisted sidecar PID).
      try {
        const live = await keeperWriter.discoverExistingKeepers();
        for (const k of live) {
          // Associate the discovery result with its registry entry by KEEPER
          // PID — never by k.sessionId, which is the keeper transport id
          // (spawn argv UUID), not pi's session UUID (task 1.3).
          const existing = entries.get(k.keeperPid);
          if (!existing) continue;

          // Reattach keeper transport info to a freshly-reclaimed entry that
          // does not yet carry it. Defensive: do not blow away a live set.
          if (existing.keeperPid === undefined) {
            existing.keeperPid = k.keeperPid;
            existing.keeperSockPath = k.sockPath;
            persist();
          }

          // pi-PID reconciliation (Decisions 3 + 5). Reclaim restores
          // keeperPid from disk, so the entry ALWAYS has keeperPid here — the
          // old `keeperPid === undefined` guard skipped exactly this, the
          // primary population this change targets (task 1.3, task 5.6). The
          // sidecar FILLS an absent piPid; it never arbitrates against a live
          // capture. One [keeper-identity] line per keeper records the outcome.
          // A RESTORED entry records the sidecar pid only when it verifies
          // against the pi-PID sidecar's mtime; the mtime becomes its
          // `piLinkedAt`. A mismatched pid is never recorded, so a cleared
          // recycled pid cannot be refilled. See change: guard-restored-headless-identity (D3).
          if (existing.piPid === undefined && k.piPid !== undefined) {
            const v = existing.restored ? await verify(k.piPid, k.piPidAnchorMs) : "match";
            if (v === "match") {
              existing.piPid = k.piPid;
              if (existing.restored && k.piPidAnchorMs !== undefined) {
                existing.piLinkedAt = Math.min(k.piPidAnchorMs, Date.now());
              }
              persist();
              console.error(
                `[keeper-identity] recorded piPid=${k.piPid} keeperPid=${k.keeperPid} session=${k.sessionId}`,
              );
            } else {
              console.warn(identityLogLine(v, k.piPid, "pi", existing.sessionId));
              console.error(
                `[keeper-identity] not recorded (${v}) piPid=${k.piPid} keeperPid=${k.keeperPid} session=${k.sessionId}`,
              );
            }
          } else if (existing.piPid !== undefined) {
            console.error(
              `[keeper-identity] unchanged piPid=${existing.piPid} keeperPid=${k.keeperPid} session=${k.sessionId}`,
            );
          } else {
            console.error(
              `[keeper-identity] unavailable keeperPid=${k.keeperPid} session=${k.sessionId}`,
            );
          }
        }
        // Report the live keeper sessionIds so cold-start recovery can gate on
        // them. See change: fix-recovery-offer-bridge-liveness-gate.
        return live.map((k) => k.sessionId);
      } catch (err) {
        console.warn("[headless-pid-registry] cleanupKeeperOrphans failed", err);
        return [];
      }
    },

    async cleanupOrphans(): Promise<void> {
      if (isUnsafeTestHomeScan()) {
        console.warn("[headless-pid-registry] cleanupOrphans() blocked: running under vitest with real HOME");
        return;
      }
      const persisted = loadFromDisk();
      const now = Date.now();

      // Verify every persisted spawn pid concurrently (one probe per live pid;
      // a gone pid is never probed). See change: guard-restored-headless-identity (D4).
      const verdicts = await Promise.all(
        persisted.map((entry) =>
          verify(entry.pid, parseAnchor(entry.spawnedAt)).catch((): IdentityVerdict => "unverifiable"),
        ),
      );

      for (const [i, entry] of persisted.entries()) {
        const verdict = verdicts[i];
        // Dead process — skip (will be removed from file on persist).
        if (verdict === "gone") continue;
        const spawnedAt = parseAnchor(entry.spawnedAt) ?? Number.NaN;
        const age = now - spawnedAt;
        const kind: IdentityKind = entry.keeperPid !== undefined ? "keeper" : "spawn";

        if (age > MAX_ORPHAN_AGE_MS) {
          if (verdict === "match") {
            // Very old orphan — escalate via SIGTERM → 2 s → SIGKILL ladder
            // (uniform with killBySessionId after change:
            // fix-keeper-kill-escalation). Only a verified pid is killed.
            try {
              await killProcess(entry.pid, { timeoutMs: 2000 });
            } catch {
              // Already dead
            }
            continue;
          }
          if (verdict === "mismatch") {
            // A recycled very old pid: drop the entry, no signal.
            console.warn(identityLogLine("mismatch", entry.pid, kind));
            continue;
          }
          // Unverifiable: no signal; fall through to reclaim.
          console.warn(identityLogLine("unverifiable (7-day kill skipped)", entry.pid, kind));
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
          restored: true,
        };
        if (verdict === "mismatch") {
          // Reclaimed so it is re-evaluated next restart, but never signalled.
          reclaimed.identityRefused = true;
          console.warn(identityLogLine("mismatch", entry.pid, kind));
        }
        if (entry.spawnToken) reclaimed.spawnToken = entry.spawnToken;
        if (entry.piPid !== undefined) {
          reclaimed.piPid = entry.piPid;
          const linkedAt = parseAnchor(entry.piLinkedAt);
          if (linkedAt !== undefined) reclaimed.piLinkedAt = linkedAt;
        }
        if (entry.keeperPid !== undefined) reclaimed.keeperPid = entry.keeperPid;
        if (entry.keeperSockPath) reclaimed.keeperSockPath = entry.keeperSockPath;
        if (entry.pluginRef) reclaimed.pluginRef = entry.pluginRef;
        entries.set(entry.pid, reclaimed);
      }

      persist();
    },
  };
}

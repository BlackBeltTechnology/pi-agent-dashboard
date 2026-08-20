/**
 * Spawn-register watchdog.
 *
 * Arms a per-spawn timer after every successful `spawnPiSession`. If the
 * spawned pi session never sends `session_register` within the timeout
 * window, emits `spawn_register_timeout` to the originating WebSocket.
 *
 * Two index maps handle the two spawn families:
 *  - `byPid` — headless spawns where the dashboard owns the PID.
 *  - `byCwd` — tmux/wt/wsl-tmux spawns where any `session_register` from
 *    that directory clears the watch.
 *
 * Late registrations (pi finally registers after the watchdog fired) are
 * detected via `recentlyFired` (60 s TTL) and cause a `spawn_register_recovered`
 * message to auto-clear the timeout banner.
 *
 * Firing also RECLAIMS the spawn. A pi that never registers is unreachable by
 * every other teardown path — no session record, so no shutdown, no reap, no
 * idle-reclaim — and it is not hypothetical: three tmux panes were measured
 * sitting forever on pi's interactive "Trust project folder?" prompt for an
 * untrusted cwd, ~127 MB each, while this watchdog reported the timeout and
 * moved on. The kill keys on the spawn token in the process ENVIRONMENT because
 * for a tmux spawn that is the only handle that exists: `tmux new-window`
 * returns tmux's pid, not pi's, and the pane's command line carries nothing
 * identifying.
 *
 * See change: spawn-failure-diagnostics, fix-tmux-session-shutdown-leak (D5).
 */

import { readFileSync, realpathSync } from "node:fs";
import type {
  SpawnRegisterRecoveredMessage,
  SpawnRegisterTimeoutMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { clampSpawnRegisterTimeoutMs, loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { killProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { findPidsBySpawnToken } from "@blackbelt-technology/pi-dashboard-shared/platform/process-identify.js";
import type { SpawnMechanism } from "@blackbelt-technology/pi-dashboard-shared/platform/spawn-mechanism.js";
import WebSocket from "ws";
import { appendSpawnFailure } from "./spawn-failure-log.js";
import { RECOVERY_GRACE_MS } from "./spawn-recovery-window.js";

/**
 * Compare cwds the same way on both sides of the arm/clear pair. A tmux spawn
 * armed with `/tmp/x` used to miss a register reporting `/private/tmp/x`.
 * Falls back to the raw string on ANY error (ENOENT for a path not yet created,
 * EACCES for an unreadable parent) so normalization can never throw on a hot
 * path. See change: fix-spawn-correlation-ttl-coupling (D4).
 */
export function normalizeCwdKey(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}

/** Injection seam for the reclaim path, so tests never touch real processes. */
export interface WatchdogReclaimDeps {
  findPidsBySpawnToken: (token: string) => number[];
  kill: (pid: number) => void;
}

export interface WatchdogArmOptions {
  pid?: number;
  cwd: string;
  mechanism: SpawnMechanism;
  logPath?: string;
  /**
   * Browser transport for the diagnostic, when the caller has one. REST
   * resume, zombie reopen and headless reload arm without a browser socket;
   * the *reclaim* must still run, so this is optional and only the diagnostic
   * is skipped when absent.
   * See change: fix-duplicate-bridge-registration (D0/D2).
   */
  ws?: WebSocket;
  /**
   * Server-minted spawn correlation token. When provided, the entry is
   * indexed in `byToken` for strong-identity clearing via `clearByToken`.
   * See change: spawn-correlation-token.
   */
  spawnToken?: string;
}

interface Entry {
  timer: ReturnType<typeof setTimeout>;
  /** Raw cwd as the caller reported it — what the browser diagnostic names. */
  cwd: string;
  /** Normalized cwd — the `byCwd` index key. */
  cwdKey: string;
  pid?: number;
  mechanism: SpawnMechanism;
  logPath?: string;
  ws?: WebSocket;
  timeoutMs: number;
  spawnToken?: string;
}

interface RecentlyFiredEntry {
  firedAt: number;
  cwd: string;
  mechanism: SpawnMechanism;
  pid?: number;
  ws?: WebSocket;
  spawnToken?: string;
  /** Evicts the entry once the recovery window closes. */
  evictTimer: ReturnType<typeof setTimeout>;
}

/** Which identity tier matched a late clear — logged, and nothing else. */
type ClearTier = "token" | "pid" | "cwd";

export class SpawnRegisterWatchdog {
  /** Default timeout used when arm() callers do not supply one. */
  readonly timeoutMs: number;
  private readonly byPid = new Map<number, Entry>();
  private readonly byCwd = new Map<string, Entry>();
  private readonly byToken = new Map<string, Entry>();
  private readonly recentlyFired = new Map<string, RecentlyFiredEntry>();

  private readonly reclaim: WatchdogReclaimDeps;

  constructor(timeoutMs: number, reclaim?: Partial<WatchdogReclaimDeps>) {
    this.timeoutMs = clampSpawnRegisterTimeoutMs(timeoutMs);
    this.reclaim = {
      findPidsBySpawnToken: reclaim?.findPidsBySpawnToken ?? findPidsBySpawnToken,
      kill:
        reclaim?.kill ??
        ((pid) => {
          // Same SIGTERM → 2 s → SIGKILL ladder every other teardown path uses.
          // Fire-and-forget: the diagnostic below must not wait on it.
          void killProcess(pid, { timeoutMs: 2000 }).catch(() => undefined);
        }),
    };
  }

  arm(opts: WatchdogArmOptions & { timeoutMs?: number }): void {
    // Read-on-arm: caller passes the current config value so a Settings change
    // takes effect on the next spawn without a server restart.
    // See change: spawn-failure-diagnostics (fix W1).
    const effectiveTimeout = clampSpawnRegisterTimeoutMs(opts.timeoutMs ?? this.timeoutMs);
    const { pid, cwd, mechanism, logPath, ws, spawnToken } = opts;
    const cwdKey = normalizeCwdKey(cwd);
    const entry: Entry = {
      timer: null as unknown as ReturnType<typeof setTimeout>,
      cwd, cwdKey, pid, mechanism, logPath, ws,
      timeoutMs: effectiveTimeout,
      spawnToken,
    };
    entry.timer = setTimeout(() => this._fireEntry(entry), effectiveTimeout);
    // Always index by cwd so a `session_register` clears the watchdog even
    // when the bridge's reported pid differs from the spawner's pid (e.g.
    // headless `--mode rpc` spawn returns the RPC keeper PID, not pi's PID;
    // pi's PID arrives later via `session_register`). Index by pid
    // additionally for late-recovery lookup. Index by token (when provided)
    // for strong-identity clearing. See change: spawn-correlation-token,
    // enable-rpc-keeper-by-default.
    // Replace any prior entry for the same cwd/pid/token to avoid leaking timers.
    const priorCwd = this.byCwd.get(cwdKey);
    // Only DISARM a prior entry that has no strong identity of its own. A prior
    // spawn with its own token is a separate, still-unregistered process: three
    // concurrent spawns into one cwd used to collapse into one watch, so two
    // leaked pi were never diagnosed and (now) would never be reclaimed. Its
    // own `clearByToken` cancels it when it actually registers.
    // See change: fix-tmux-session-shutdown-leak.
    if (priorCwd && !priorCwd.spawnToken) clearTimeout(priorCwd.timer);
    this.byCwd.set(cwdKey, entry);
    if (pid !== undefined) {
      const priorPid = this.byPid.get(pid);
      if (priorPid && priorPid !== priorCwd) clearTimeout(priorPid.timer);
      this.byPid.set(pid, entry);
    }
    if (spawnToken) {
      const priorTok = this.byToken.get(spawnToken);
      if (priorTok && priorTok !== priorCwd && priorTok !== entry) clearTimeout(priorTok.timer);
      this.byToken.set(spawnToken, entry);
    }
  }

  /**
   * Strong-identity clear: cancel watchdog for this exact spawn invocation.
   * Tier 1 of the three-tier match in `event-wiring.ts`. Removes the entry
   * from all three indices. See change: spawn-correlation-token.
   */
  clearByToken(spawnToken: string): boolean {
    const entry = this.byToken.get(spawnToken);
    if (entry) {
      clearTimeout(entry.timer);
      this._dropFromIndices(entry);
      return true;
    }
    // Check for late recovery: `recentlyFired` is keyed by token when the entry
    // has one, so this is a direct lookup rather than a scan.
    const fired = this.recentlyFired.get(spawnToken);
    if (fired && fired.spawnToken === spawnToken) {
      return this._emitRecovery(spawnToken, fired, "token");
    }
    return false;
  }

  clearByPid(pid: number): boolean {
    const entry = this.byPid.get(pid);
    if (entry) {
      clearTimeout(entry.timer);
      this._dropFromIndices(entry);
      return true;
    }
    // Check for late recovery.
    return this._checkRecoveryByPid(pid);
  }

  clearByCwd(cwd: string): boolean {
    const cwdKey = normalizeCwdKey(cwd);
    const entry = this.byCwd.get(cwdKey);
    if (entry) {
      clearTimeout(entry.timer);
      this._dropFromIndices(entry);
      return true;
    }
    // Check for late recovery. An entry that HAS a token is indexed under it,
    // so a cwd clear cannot recover another spawn's fire.
    const fired = this.recentlyFired.get(cwdKey);
    if (!fired) return false;
    return this._emitRecovery(cwdKey, fired, "cwd");
  }

  /** Remove an entry from every index that still points at it. */
  private _dropFromIndices(entry: Entry): void {
    const cwdEntry = this.byCwd.get(entry.cwdKey);
    if (cwdEntry === entry) this.byCwd.delete(entry.cwdKey);
    if (entry.pid !== undefined) {
      const pidEntry = this.byPid.get(entry.pid);
      if (pidEntry === entry) this.byPid.delete(entry.pid);
    }
    if (entry.spawnToken) {
      const tokEntry = this.byToken.get(entry.spawnToken);
      if (tokEntry === entry) this.byToken.delete(entry.spawnToken);
    }
  }

  /** Number of fires still inside their recovery window (tests only). */
  _recentlyFiredSize(): number {
    return this.recentlyFired.size;
  }

  private _fireEntry(entry: Entry): void {
    const { cwd, pid, logPath, ws, timeoutMs: entryTimeoutMs } = entry;
    // Remove from active maps.
    this._dropFromIndices(entry);

    // Record for late-recovery detection under ONE index: the token when the
    // entry has one, the normalized cwd only when it does not. Keying every
    // fire by cwd let a second same-cwd fire overwrite the first's recovery
    // entry. See change: fix-spawn-correlation-ttl-coupling (D4).
    const firedKey = entry.spawnToken ?? entry.cwdKey;
    const fired: RecentlyFiredEntry = {
      firedAt: Date.now(),
      cwd,
      mechanism: entry.mechanism,
      pid,
      ws,
      spawnToken: entry.spawnToken,
      // Evict on the window closing rather than only when some later clear
      // happens to look: 5 000 spawns that never register must not retain
      // their fire records forever.
      //
      // Guarded on IDENTITY, not just the key: two token-less spawns in one
      // cwd share a key, so the first fire's timer would otherwise evict the
      // SECOND fire's record early and silently truncate its recovery window.
      evictTimer: null as unknown as ReturnType<typeof setTimeout>,
    };
    fired.evictTimer = setTimeout(() => {
      if (this.recentlyFired.get(firedKey) === fired) this.recentlyFired.delete(firedKey);
    }, RECOVERY_GRACE_MS);
    // A same-key predecessor is being replaced here; drop its timer with it.
    const priorFired = this.recentlyFired.get(firedKey);
    if (priorFired) clearTimeout(priorFired.evictTimer);
    this.recentlyFired.set(firedKey, fired);

    console.error(
      `[watchdog] FIRE cwd=${cwd} pid=${pid ?? "unknown"} ` +
        `token=${entry.spawnToken ?? "none"} timeout=${entryTimeoutMs}ms`,
    );

    // Read stderr tail if logPath available.
    let stderrTail: string | undefined;
    if (logPath) {
      stderrTail = readLogTail(logPath);
    }

    // Persist the timeout to the rolling failure log. See change: spawn-failure-diagnostics.
    appendSpawnFailure({
      ts: new Date().toISOString(),
      cwd,
      strategy: entry.mechanism,
      code: "REGISTER_TIMEOUT",
      // The timeout that ACTUALLY applied to this entry, not the constructor
      // default — the latter is stale after any live Settings change.
      // See change: fix-spawn-correlation-ttl-coupling (D5).
      message: `Pi session spawned but never registered (timeout ${entryTimeoutMs}ms)`,
      ...(pid !== undefined ? { pid } : {}),
      ...(entry.spawnToken ? { spawnToken: entry.spawnToken } : {}),
      ...(stderrTail ? { stderrTail } : {}),
    });

    // Reclaim BEFORE the `readyState` early-return: the leak is real whether or
    // not a browser is still listening for the diagnostic.
    this._reclaimSpawn(entry);

    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const msg: SpawnRegisterTimeoutMessage = {
      type: "spawn_register_timeout",
      cwd,
      timeoutMs: entryTimeoutMs,
      ...(pid !== undefined ? { pid } : {}),
      ...(stderrTail ? { stderrTail } : {}),
    };
    ws.send(JSON.stringify(msg));
  }

  /**
   * Terminate the process behind a spawn that never registered.
   *
   * Token first (the only handle a tmux/wt/wsl-tmux pane has), then the spawn
   * pid for headless, where the dashboard owns it directly. Never throws: a
   * failed reclaim must not suppress the diagnostic that makes the leak visible.
   */
  private _reclaimSpawn(entry: Entry): void {
    try {
      const pids = entry.spawnToken
        ? this.reclaim.findPidsBySpawnToken(entry.spawnToken)
        : [];
      const candidates = pids.length > 0 ? pids : entry.pid !== undefined ? [entry.pid] : [];
      // Unconditional net under the probe's own leaf-`pi` narrowing: the token
      // is an inherited env var, so a widened match can name the dashboard
      // itself. Killing that takes down every session at once.
      const targets = candidates.filter((pid) => pid !== process.pid && pid !== process.ppid);
      for (const pid of targets) this.reclaim.kill(pid);
    } catch {
      /* reporting the timeout matters more than reclaiming it */
    }
  }

  private _checkRecoveryByPid(pid: number): boolean {
    // recentlyFired is keyed by token-or-cwd; scan to find a matching pid.
    for (const [key, fired] of this.recentlyFired) {
      if (fired.pid === pid) {
        return this._emitRecovery(key, fired, "pid");
      }
    }
    return false;
  }

  /**
   * Emit at most one `spawn_register_recovered` per fire. The entry is dropped
   * whether or not a message goes out, so a second clear on another tier cannot
   * emit a duplicate. Returns whether the fire was claimed by this clear.
   */
  private _emitRecovery(key: string, fired: RecentlyFiredEntry, tier: ClearTier): boolean {
    this.recentlyFired.delete(key);
    clearTimeout(fired.evictTimer);

    // TTL check — the recovery window is the SAME constant every correlation
    // TTL derives from. See change: fix-spawn-correlation-ttl-coupling.
    if (Date.now() - fired.firedAt > RECOVERY_GRACE_MS) return false;

    console.error(
      `[watchdog] RECOVERED cwd=${fired.cwd} pid=${fired.pid ?? "unknown"} ` +
        `token=${fired.spawnToken ?? "none"} tier=${tier}`,
    );
    // Companion record joined to the fire by token, so a triaged
    // REGISTER_TIMEOUT can be told from one that never recovered.
    // See change: fix-spawn-correlation-ttl-coupling (D5).
    appendSpawnFailure({
      ts: new Date().toISOString(),
      cwd: fired.cwd,
      strategy: fired.mechanism,
      code: "REGISTER_RECOVERED",
      message: `Pi session registered after its watchdog fired (tier ${tier})`,
      ...(fired.pid !== undefined ? { pid: fired.pid } : {}),
      ...(fired.spawnToken ? { spawnToken: fired.spawnToken } : {}),
    });

    if (!fired.ws || fired.ws.readyState !== WebSocket.OPEN) return true;

    // No `requestId` here by design: the watchdog has no access to the
    // correlation map, and `session_added` is what carries the value.
    // See change: fix-spawn-correlation-ttl-coupling (D2).
    const msg: SpawnRegisterRecoveredMessage = {
      type: "spawn_register_recovered",
      cwd: fired.cwd,
      ...(fired.pid !== undefined ? { pid: fired.pid } : {}),
    };
    fired.ws.send(JSON.stringify(msg));
    return true;
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance: SpawnRegisterWatchdog | null = null;

/**
 * Lazy singleton. On first call, reads `spawnRegisterTimeoutMs` from config.
 * Tests can swap the instance via `_setSpawnRegisterWatchdogForTests`.
 */
export function getSpawnRegisterWatchdog(): SpawnRegisterWatchdog {
  if (!_instance) {
    const config = loadConfig();
    _instance = new SpawnRegisterWatchdog(config.spawnRegisterTimeoutMs);
  }
  return _instance;
}

/** Swap the singleton for tests. Pass `null` to reset. */
export function _setSpawnRegisterWatchdogForTests(w: SpawnRegisterWatchdog | null): void {
  _instance = w;
}

/** The subset of a `spawnPiSession` result the watchdog needs to arm. */
export interface ArmableSpawnResult {
  success?: boolean;
  pid?: number;
  logPath?: string;
  spawnToken?: string;
}

/**
 * Arm the watchdog for a successful spawn from ANY entry point.
 *
 * Every spawn must be armed, not just the WebSocket one: a duplicate whose
 * `session_register` is refused for contention is only reclaimed because its
 * watchdog is still armed, and the incident's duplicate was minted through the
 * REST path. `ws` is optional — a transport-less caller still gets the reclaim,
 * only the browser diagnostic is skipped.
 *
 * See change: fix-duplicate-bridge-registration (D0/D2).
 */
export function armSpawnWatchdog(
  cwd: string,
  mechanism: SpawnMechanism,
  result: ArmableSpawnResult,
  ws?: WebSocket,
  timeoutMs?: number,
): number | undefined {
  if (result.success === false) return undefined;
  // One config read per spawn: a caller that already read the config passes its
  // value in, and every TTL that must outlive this arm derives from the value
  // RETURNED here. Only callers with no read of their own fall back to reading
  // now. See change: fix-spawn-correlation-ttl-coupling (D1).
  const effectiveTimeout = clampSpawnRegisterTimeoutMs(
    timeoutMs ?? loadConfig().spawnRegisterTimeoutMs,
  );
  // Never throws: the watchdog is a diagnostic + reclaim safety net layered on
  // top of the spawn. Failing to arm it must not abort the spawn it is
  // watching — that would turn a missing safety net into a broken feature.
  try {
    getSpawnRegisterWatchdog().arm({
      cwd,
      mechanism,
      pid: result.pid,
      logPath: result.logPath,
      spawnToken: result.spawnToken,
      timeoutMs: effectiveTimeout,
      ...(ws ? { ws } : {}),
    });
  } catch (err) {
    console.error(
      `[watchdog] failed to arm for ${cwd}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return effectiveTimeout;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readLogTail(filePath: string, maxBytes = 4096): string | undefined {
  try {
    const buf = readFileSync(filePath);
    if (!buf.length) return undefined;
    const slice = buf.length <= maxBytes ? buf : buf.slice(buf.length - maxBytes);
    let start = 0;
    while (start < slice.length && (slice[start]! & 0xC0) === 0x80) start++;
    return slice.slice(start).toString("utf-8");
  } catch {
    return undefined;
  }
}

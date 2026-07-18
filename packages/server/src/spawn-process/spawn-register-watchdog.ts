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
 * See change: spawn-failure-diagnostics.
 */
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import type { SpawnMechanism } from "@blackbelt-technology/pi-dashboard-shared/platform/spawn-mechanism.js";
import type {
  SpawnRegisterTimeoutMessage,
  SpawnRegisterRecoveredMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { clampSpawnRegisterTimeoutMs, loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { appendSpawnFailure } from "./spawn-failure-log.js";

export interface WatchdogArmOptions {
  pid?: number;
  cwd: string;
  mechanism: SpawnMechanism;
  logPath?: string;
  ws: WebSocket;
  /**
   * Server-minted spawn correlation token. When provided, the entry is
   * indexed in `byToken` for strong-identity clearing via `clearByToken`.
   * See change: spawn-correlation-token.
   */
  spawnToken?: string;
}

interface Entry {
  timer: ReturnType<typeof setTimeout>;
  cwd: string;
  pid?: number;
  mechanism: SpawnMechanism;
  logPath?: string;
  ws: WebSocket;
  timeoutMs: number;
  spawnToken?: string;
}

interface RecentlyFiredEntry {
  firedAt: number;
  pid?: number;
  ws: WebSocket;
  spawnToken?: string;
}

const RECENTLY_FIRED_TTL_MS = 60_000;

export class SpawnRegisterWatchdog {
  /** Default timeout used when arm() callers do not supply one. */
  readonly timeoutMs: number;
  private readonly byPid = new Map<number, Entry>();
  private readonly byCwd = new Map<string, Entry>();
  private readonly byToken = new Map<string, Entry>();
  private readonly recentlyFired = new Map<string, RecentlyFiredEntry>();

  constructor(timeoutMs: number) {
    this.timeoutMs = clampSpawnRegisterTimeoutMs(timeoutMs);
  }

  arm(opts: WatchdogArmOptions & { timeoutMs?: number }): void {
    // Read-on-arm: caller passes the current config value so a Settings change
    // takes effect on the next spawn without a server restart.
    // See change: spawn-failure-diagnostics (fix W1).
    const effectiveTimeout = clampSpawnRegisterTimeoutMs(opts.timeoutMs ?? this.timeoutMs);
    const { pid, cwd, mechanism, logPath, ws, spawnToken } = opts;
    const entry: Entry = {
      timer: null as unknown as ReturnType<typeof setTimeout>,
      cwd, pid, mechanism, logPath, ws,
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
    const priorCwd = this.byCwd.get(cwd);
    if (priorCwd) clearTimeout(priorCwd.timer);
    this.byCwd.set(cwd, entry);
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
  clearByToken(spawnToken: string): void {
    const entry = this.byToken.get(spawnToken);
    if (entry) {
      clearTimeout(entry.timer);
      this.byToken.delete(spawnToken);
      const cwdEntry = this.byCwd.get(entry.cwd);
      if (cwdEntry === entry) this.byCwd.delete(entry.cwd);
      if (entry.pid !== undefined) {
        const pidEntry = this.byPid.get(entry.pid);
        if (pidEntry === entry) this.byPid.delete(entry.pid);
      }
      return;
    }
    // Check for late recovery: scan recentlyFired for matching token.
    for (const [cwd, fired] of this.recentlyFired) {
      if (fired.spawnToken === spawnToken) {
        this._emitRecovery(cwd, fired);
        return;
      }
    }
  }

  clearByPid(pid: number): void {
    const entry = this.byPid.get(pid);
    if (entry) {
      clearTimeout(entry.timer);
      this.byPid.delete(pid);
      // Also clear cwd / token entries if they point at the same arm.
      const cwdEntry = this.byCwd.get(entry.cwd);
      if (cwdEntry === entry) this.byCwd.delete(entry.cwd);
      if (entry.spawnToken) {
        const tokEntry = this.byToken.get(entry.spawnToken);
        if (tokEntry === entry) this.byToken.delete(entry.spawnToken);
      }
      return;
    }
    // Check for late recovery.
    this._checkRecoveryByPid(pid);
  }

  clearByCwd(cwd: string): void {
    const entry = this.byCwd.get(cwd);
    if (entry) {
      clearTimeout(entry.timer);
      this.byCwd.delete(cwd);
      // Also clear pid / token entries if they point at the same arm.
      if (entry.pid !== undefined) {
        const pidEntry = this.byPid.get(entry.pid);
        if (pidEntry === entry) this.byPid.delete(entry.pid);
      }
      if (entry.spawnToken) {
        const tokEntry = this.byToken.get(entry.spawnToken);
        if (tokEntry === entry) this.byToken.delete(entry.spawnToken);
      }
      return;
    }
    // Check for late recovery.
    this._checkRecoveryByCwd(cwd);
  }

  private _fireEntry(entry: Entry): void {
    const { cwd, pid, logPath, ws, timeoutMs: entryTimeoutMs } = entry;
    // Remove from active maps.
    if (pid !== undefined) {
      const pidEntry = this.byPid.get(pid);
      if (pidEntry === entry) this.byPid.delete(pid);
    }
    const cwdEntry = this.byCwd.get(cwd);
    if (cwdEntry === entry) this.byCwd.delete(cwd);

    // Record in recentlyFired for late-recovery detection (also drop token entry).
    if (entry.spawnToken) {
      const tokEntry = this.byToken.get(entry.spawnToken);
      if (tokEntry === entry) this.byToken.delete(entry.spawnToken);
    }
    this.recentlyFired.set(cwd, { firedAt: Date.now(), pid, ws, spawnToken: entry.spawnToken });

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
      message: `Pi session spawned but never registered (timeout ${this.timeoutMs}ms)`,
      ...(pid !== undefined ? { pid } : {}),
      ...(stderrTail ? { stderrTail } : {}),
    });

    if (ws.readyState !== WebSocket.OPEN) return;

    const msg: SpawnRegisterTimeoutMessage = {
      type: "spawn_register_timeout",
      cwd,
      timeoutMs: entryTimeoutMs,
      ...(pid !== undefined ? { pid } : {}),
      ...(stderrTail ? { stderrTail } : {}),
    };
    ws.send(JSON.stringify(msg));
  }

  private _checkRecoveryByPid(pid: number): void {
    // recentlyFired is keyed by cwd; scan to find matching pid.
    for (const [cwd, fired] of this.recentlyFired) {
      if (fired.pid === pid) {
        this._emitRecovery(cwd, fired);
        return;
      }
    }
  }

  private _checkRecoveryByCwd(cwd: string): void {
    const fired = this.recentlyFired.get(cwd);
    if (!fired) return;
    this._emitRecovery(cwd, fired);
  }

  private _emitRecovery(cwd: string, fired: RecentlyFiredEntry): void {
    // TTL check.
    if (Date.now() - fired.firedAt > RECENTLY_FIRED_TTL_MS) {
      this.recentlyFired.delete(cwd);
      return;
    }

    this.recentlyFired.delete(cwd);

    if (fired.ws.readyState !== WebSocket.OPEN) return;

    const msg: SpawnRegisterRecoveredMessage = {
      type: "spawn_register_recovered",
      cwd,
      ...(fired.pid !== undefined ? { pid: fired.pid } : {}),
    };
    fired.ws.send(JSON.stringify(msg));
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

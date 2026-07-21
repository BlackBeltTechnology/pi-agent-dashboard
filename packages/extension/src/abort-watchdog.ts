import { killPidWithGroup } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { killProcessByPgid, scanChildProcesses, type ChildProcessInfo } from "./process-scanner.js";

export type AbortWatchdogSignal = "SIGTERM" | "SIGKILL";

export interface AbortWatchdogOptions {
  delayMs?: number;
  killGraceMs?: number;
  isLatchActive: (sessionId: string) => boolean;
  isStreaming: () => boolean;
  scanChildren?: () => ChildProcessInfo[];
  killGroup?: (pgid: number, signal: AbortWatchdogSignal) => void;
}

const DEFAULT_DELAY_MS = 10_000;
const DEFAULT_KILL_GRACE_MS = 2_000;

/**
 * User-abort safety net: if pi's cooperative abort cannot land because a tool
 * ignores AbortSignal, kill child process groups after a short grace window.
 * Fires only for an explicit latched user abort; never for healthy tools.
 */
export class AbortWatchdog {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private killTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private fired = new Set<string>();
  private readonly delayMs: number;
  private readonly killGraceMs: number;
  private readonly isLatchActive: (sessionId: string) => boolean;
  private readonly isStreaming: () => boolean;
  private readonly scanChildren: () => ChildProcessInfo[];
  private readonly killGroup: (pgid: number, signal: AbortWatchdogSignal) => void;

  constructor(options: AbortWatchdogOptions) {
    this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.isLatchActive = options.isLatchActive;
    this.isStreaming = options.isStreaming;
    this.scanChildren = options.scanChildren ?? (() => scanChildProcesses(process.pid, new Set(), 0));
    this.killGroup = options.killGroup ?? defaultKillGroup;
  }

  arm(sessionId: string): void {
    this.disarm(sessionId);
    this.fired.delete(sessionId);
    this.timers.set(sessionId, setTimeout(() => this.fire(sessionId), this.delayMs));
  }

  disarm(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.timers.delete(sessionId);
    const killTimer = this.killTimers.get(sessionId);
    if (killTimer) clearTimeout(killTimer);
    this.killTimers.delete(sessionId);
    this.fired.delete(sessionId);
  }

  dispose(): void {
    for (const sessionId of new Set([...this.timers.keys(), ...this.killTimers.keys()])) {
      this.disarm(sessionId);
    }
  }

  private fire(sessionId: string): void {
    this.timers.delete(sessionId);
    if (this.fired.has(sessionId)) return;
    this.fired.add(sessionId);
    if (!this.isLatchActive(sessionId) || !this.isStreaming()) return;
    const pgids = uniquePgids(this.scanChildren());
    if (pgids.length === 0) return;
    for (const pgid of pgids) this.safeKill(pgid, "SIGTERM");
    this.killTimers.set(sessionId, setTimeout(() => {
      this.killTimers.delete(sessionId);
      if (!this.isLatchActive(sessionId) || !this.isStreaming()) return;
      for (const pgid of uniquePgids(this.scanChildren())) this.safeKill(pgid, "SIGKILL");
    }, this.killGraceMs));
  }

  private safeKill(pgid: number, signal: AbortWatchdogSignal): void {
    try {
      this.killGroup(pgid, signal);
    } catch {
      /* already dead */
    }
  }
}

function uniquePgids(children: ChildProcessInfo[]): number[] {
  return [...new Set(children.map((c) => c.pgid).filter((pgid) => Number.isFinite(pgid) && pgid > 0))];
}

function defaultKillGroup(pgid: number, signal: AbortWatchdogSignal): void {
  if (signal === "SIGTERM" || process.platform === "win32") {
    killProcessByPgid(pgid);
    return;
  }
  killPidWithGroup(pgid, "SIGKILL");
}

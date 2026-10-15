/**
 * ONE termination primitive for every server-initiated kill of a session's
 * `pi` process: the unattended reclaims (idle reaper, caps, automation stop)
 * and `shutdownSession`.
 *
 * Strategy-agnostic by construction: it keys on the identity the server already
 * holds (`session.pid` from `session_register`), plus the headless registry's
 * entry when one exists — never on the spawn strategy. The registry only holds
 * headless spawns, so a registry-only kill leaks a tmux/wt `pi` (#459).
 *
 * Ladder (design D1): stamp close reason → registry kill (an ATTEMPT, never a
 * verdict) → resolve pid → already-gone probe → optional grace poll → identity
 * guard (unattended only) → `killProcess` → confirm by errno-aware `signalZero`
 * (only ESRCH proves death) → withdraw the close stamp when not confirmed.
 *
 * All signalling goes through `killProcess`; this module never calls
 * `process.kill` itself (no-direct-process-kill invariant).
 *
 * See change: fix-session-reclaim-tmux.
 */
import {
  killProcess as defaultKillProcess,
  processStartedAt as defaultProcessStartedAt,
  signalZero as defaultSignalZero,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { findPidsBySpawnToken as defaultFindPidsBySpawnToken } from "@blackbelt-technology/pi-dashboard-shared/platform/process-identify.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { HeadlessPidRegistry } from "./headless-pid-registry.js";

/** Tolerance between a pi's start time and the server stamping its pid (ms). */
export const IDENTITY_TOLERANCE_MS = 2000;
const GRACE_POLL_MS = 100;

export type TerminateOutcome = "confirmed-dead" | "unconfirmed" | "refused-identity" | "no-identity";

export interface TerminateResult {
  outcome: TerminateOutcome;
  /** `true` iff `outcome === "confirmed-dead"`. */
  terminated: boolean;
  pid?: number;
}

export interface TerminateOptions {
  /** Poll liveness this long after the registry rung before escalating (shutdown only). */
  graceMs?: number;
  /** Server-minted spawn token — reclaims a spawn that has not registered yet. */
  spawnToken?: string;
  /** Refuse to signal `session.pid` unless its start time is consistent with registration. */
  verifyIdentity?: boolean;
  /** Stamp in-memory `closedReason: "manual"` before signalling (unattended callers). */
  stampManualClose?: boolean;
}

/** An empty `sessionId` means "token-only": no record or registry-by-id rung, only the spawn-token rung. */
export type Terminate = (sessionId: string, opts?: TerminateOptions) => Promise<TerminateResult>;

/** The slice of the session manager the terminator needs. */
interface TerminatorSessionManager {
  get(sessionId: string): DashboardSession | undefined;
  update(sessionId: string, updates: Partial<DashboardSession>): void;
}

/** Injectable primitives (test seams). */
interface TerminatorPrimitives {
  signalZero?: typeof defaultSignalZero;
  killProcess?: typeof defaultKillProcess;
  processStartedAt?: typeof defaultProcessStartedAt;
  findPidsBySpawnToken?: typeof defaultFindPidsBySpawnToken;
  platform?: NodeJS.Platform;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  warn?: (message: string) => void;
}

export interface SessionTerminatorDeps extends TerminatorPrimitives {
  sessionManager: TerminatorSessionManager;
  headlessPidRegistry: Pick<HeadlessPidRegistry, "getPid" | "killBySessionId"> &
    Partial<Pick<HeadlessPidRegistry, "killByToken">>;
}

export function createSessionTerminator(deps: SessionTerminatorDeps): { terminate: Terminate } {
  const signalZero = deps.signalZero ?? defaultSignalZero;
  const killProcess = deps.killProcess ?? defaultKillProcess;
  const processStartedAt = deps.processStartedAt ?? defaultProcessStartedAt;
  const findPidsBySpawnToken = deps.findPidsBySpawnToken ?? defaultFindPidsBySpawnToken;
  const platform = deps.platform ?? process.platform;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const { sessionManager, headlessPidRegistry } = deps;

  /** Alive unless ESRCH proves otherwise (EPERM etc. read as alive). */
  const isGone = (pid: number): boolean => signalZero(pid) === "esrch";

  const done = (outcome: TerminateOutcome, pid?: number): TerminateResult => ({
    outcome,
    terminated: outcome === "confirmed-dead",
    ...(pid !== undefined ? { pid } : {}),
  });

  /** Spawn-token rung: a spawn that never registered has no pid on record. */
  async function reclaimByToken(token: string): Promise<TerminateResult> {
    // Registry attempt first: a headless spawn is registered under its token
    // before its session id is known. An attempt flag only — liveness decides.
    try {
      await headlessPidRegistry.killByToken?.(token);
    } catch {
      /* attempt only */
    }
    const pids = findPidsBySpawnToken(token);
    if (pids.length === 0) return done("no-identity");
    for (const p of pids) {
      if (!isGone(p)) await killProcess(p, { timeoutMs: 2000 });
    }
    const survivor = pids.find((p) => !isGone(p));
    return survivor === undefined ? done("confirmed-dead", pids[0]) : done("unconfirmed", survivor);
  }

  /** Step 1: registry attempt. Returns the registry's pid, captured BEFORE the kill. */
  async function registryRung(sessionId: string): Promise<number | undefined> {
    if (sessionId === "") return undefined;
    const registryPid = headlessPidRegistry.getPid(sessionId);
    try {
      await headlessPidRegistry.killBySessionId(sessionId);
    } catch {
      /* an attempt flag only; liveness decides */
    }
    return registryPid;
  }

  /** Step 4: poll for a graceful exit (shutdown has sent the advisory message first). */
  async function exitedWithin(pid: number, graceMs: number | undefined): Promise<boolean> {
    if (!graceMs || graceMs <= 0) return false;
    const now = deps.now ?? Date.now;
    const deadline = now() + graceMs;
    while (now() < deadline) {
      if (isGone(pid)) return true;
      await sleep(GRACE_POLL_MS);
    }
    return isGone(pid);
  }

  /**
   * Step 5: the start-time identity guard. Returns a refusal diagnostic when the
   * pid cannot be shown to be the registered pi, `undefined` when it may be signalled.
   */
  function identityRefusal(sessionId: string, pid: number): string | undefined {
    const recordedAt = sessionManager.get(sessionId)?.pidRecordedAt;
    const started = processStartedAt(pid);
    if (started !== null && recordedAt !== undefined && started <= recordedAt + IDENTITY_TOLERANCE_MS) {
      return undefined;
    }
    return started === null || recordedAt === undefined ? `identity unverifiable on ${platform}` : "pid reused";
  }

  /** Steps 5–7: identity guard (unattended, `session.pid` only), escalate, confirm by liveness. */
  async function escalate(
    sessionId: string,
    pid: number,
    guarded: boolean,
  ): Promise<TerminateResult> {
    const refusal = guarded ? identityRefusal(sessionId, pid) : undefined;
    if (refusal !== undefined) {
      if (isGone(pid)) return done("confirmed-dead", pid);
      warn(`[session-terminator] refusing to signal pid ${pid} for session ${sessionId}: ${refusal}`);
      return done("refused-identity", pid);
    }
    await killProcess(pid, { timeoutMs: 2000 });
    return isGone(pid) ? done("confirmed-dead", pid) : done("unconfirmed", pid);
  }

  async function ladder(sessionId: string, opts: TerminateOptions): Promise<TerminateResult> {
    // 1. Registry rung.
    const registryPid = await registryRung(sessionId);

    // 2. Resolve the pid.
    const sessionPid = sessionId === "" ? undefined : sessionManager.get(sessionId)?.pid;
    const pid = sessionPid ?? registryPid;
    if (pid === undefined) {
      return opts.spawnToken ? reclaimByToken(opts.spawnToken) : done("no-identity");
    }

    // 3–4. Already gone (before identity, so a dead pid is never "refused"), or
    // gone within the grace window.
    if (isGone(pid) || (await exitedWithin(pid, opts.graceMs))) return done("confirmed-dead", pid);

    // 5–7. The guard applies only to a `session.pid` the registry does not own.
    return escalate(sessionId, pid, opts.verifyIdentity === true && pid === sessionPid && pid !== registryPid);
  }

  async function terminate(sessionId: string, opts: TerminateOptions = {}): Promise<TerminateResult> {
    // 0. Close stamp BEFORE any signal (design D10).
    let stamped = false;
    if (opts.stampManualClose && sessionId !== "") {
      const rec = sessionManager.get(sessionId);
      if (rec && rec.status !== "ended" && rec.closedReason === undefined) {
        sessionManager.update(sessionId, { closedReason: "manual" });
        stamped = true;
      }
    }

    let result: TerminateResult | undefined;
    try {
      result = await ladder(sessionId, opts);
      return result;
    } finally {
      // 8. Withdraw the stamp when the process was not confirmed gone and the
      // record has not ended (a failed reclaim is not an intentional close).
      if (stamped && result?.outcome !== "confirmed-dead") {
        const rec = sessionManager.get(sessionId);
        if (rec && rec.status !== "ended" && rec.closedReason === "manual") {
          sessionManager.update(sessionId, { closedReason: undefined });
        }
      }
    }
  }

  return { terminate };
}

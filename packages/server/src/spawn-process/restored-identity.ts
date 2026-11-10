/**
 * One-sided start-time identity check for pids the server did NOT keep a live
 * handle on: entries the headless registry restored from disk after a restart,
 * and keeper / pi pids keeper discovery reads from sidecars.
 *
 * A recycled pid can only start AFTER the original died, so a pid matches when
 * it started no later than its anchor plus `IDENTITY_TOLERANCE_MS`. A lower
 * bound adds no safety and would add false mismatches on a wall-clock step.
 *
 * Never throws: a probe that throws, rejects or exceeds `PROBE_TIMEOUT_MS`
 * yields `unverifiable`, as does an anchor that is missing or not finite.
 *
 * See change: guard-restored-headless-identity (design D2).
 */
import {
  processStartedAt,
  signalZero,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";

/** Tolerance between a process's start time and its identity anchor (ms). */
export const IDENTITY_TOLERANCE_MS = 2000;
/** Upper bound on one start-time probe (G6). */
const PROBE_TIMEOUT_MS = 2000;
/** Total verification budget of one `killAll` (G6). */
export const KILL_ALL_VERIFY_BUDGET_MS = 5000;
/** Anchor window for a legacy `piPid` with no `piLinkedAt` stamp (Q2). */
export const LEGACY_PI_WINDOW_MS = 60_000;

export type IdentityVerdict = "match" | "gone" | "mismatch" | "unverifiable";
export type IdentityKind = "spawn" | "pi" | "keeper";

/** Start time of `pid` in epoch ms, or `null` when it cannot be determined. */
export type StartProbe = (pid: number) => Promise<number | null> | number | null;

/** Default probe: the shared platform helper (null on win32). */
export const defaultStartProbe: StartProbe = async (pid) => processStartedAt(pid);

/** Default gone check: only ESRCH proves a pid gone (EPERM reads as alive). */
const defaultIsGone = (pid: number): boolean => signalZero(pid) === "esrch";

export interface VerifyOptions {
  probe?: StartProbe;
  isGone?: (pid: number) => boolean;
  now?: () => number;
  timeoutMs?: number;
  /** Receives one line per probe failure (throw / reject / timeout). */
  log?: (line: string) => void;
}

/** The single refusal / outcome log line shape (design D4). */
export function identityLogLine(
  outcome: string,
  pid: number,
  kind: IdentityKind,
  sessionId?: string,
): string {
  return `[headless-pid-registry] identity ${outcome} pid=${pid} kind=${kind} session=${sessionId || "-"}`;
}

/** Parse an ISO timestamp; absent → `undefined`, unparseable → `NaN` (G5). */
export function parseAnchor(iso: unknown): number | undefined {
  if (iso === undefined || iso === null) return undefined;
  return typeof iso === "string" ? Date.parse(iso) : Number.NaN;
}

export async function verifyRestored(
  pid: number,
  anchorMs: number | undefined,
  opts: VerifyOptions = {},
): Promise<IdentityVerdict> {
  const isGone = opts.isGone ?? defaultIsGone;
  const probe = opts.probe ?? defaultStartProbe;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((l: string) => console.warn(l));
  try {
    if (isGone(pid)) return "gone";
  } catch {
    return "unverifiable";
  }
  if (anchorMs === undefined || !Number.isFinite(anchorMs)) return "unverifiable";
  const anchor = Math.min(anchorMs, now());

  let timer: ReturnType<typeof setTimeout> | undefined;
  let started: number | null;
  try {
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), opts.timeoutMs ?? PROBE_TIMEOUT_MS);
      timer.unref?.();
    });
    const r = await Promise.race([Promise.resolve().then(() => probe(pid)), timeout]);
    if (r === "timeout") {
      log(`[headless-pid-registry] identity probe timed out pid=${pid}`);
      return "unverifiable";
    }
    started = r;
  } catch (err) {
    log(`[headless-pid-registry] identity probe failed pid=${pid}: ${err instanceof Error ? err.message : String(err)}`);
    return "unverifiable";
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (started === null || !Number.isFinite(started)) return "unverifiable";
  return started <= anchor + IDENTITY_TOLERANCE_MS ? "match" : "mismatch";
}

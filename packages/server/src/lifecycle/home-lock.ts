/**
 * Per-HOME advisory lock for the dashboard server.
 *
 * Ensures one dashboard instance per HOME (`<realpath(os.homedir())>/.pi/`).
 * See change: single-dashboard-per-home.
 *
 * Responsibilities:
 *   - Canonicalize HOME (avoid symlink/Git-Bash drift)
 *   - Acquire the lock via `proper-lockfile` (non-blocking, stale-aware)
 *   - Write / read an atomic metadata sidecar
 *   - Verify a held lock's liveness via identity-checked health probe
 *   - Return an `acquired` or `attach` result for the caller to dispatch
 *
 * Signal handlers and release-on-exit plumbing live in
 * `home-lock-release.ts` to keep this module pure + testable.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { isProcessAlive } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { isDashboardRunning } from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";
import properLockfile from "proper-lockfile";

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

/** Metadata written alongside the lock file. JSON-serialized. */
export interface LockMetadata {
  pid: number;
  ppid: number;
  httpPort: number;
  piPort: number;
  startedAt: number;
  /** Stable per-instance identifier. Verified against /api/health to detect
   *  "port in use by unrelated dashboard or stale process with same pid." */
  identity: string;
  version: string;
  url: string;
  hostname: string;
  /** Specific non-loopback host the server bound, when it did. Optional:
   *  readers accept records without it. `url` is always `localhost`, so a
   *  liveness probe needs this to reach a server bound to one interface.
   *  See change: harden-dashboard-start-detection (D5.5). */
  bindHost?: string;
}

/** Result of `acquireOrAttach`. Callers branch on `mode`. */
export type LockAcquireResult =
  | {
      mode: "acquired";
      meta: LockMetadata;
      /** Release the lock + remove the metadata sidecar. Idempotent. A
       *  compromised hold releases nothing — both belong to the successor. */
      release: () => Promise<void>;
      /** True once a successor took the lock over (this process was frozen
       *  or starved, and noticed late). See change: harden-dashboard-start-detection. */
      readonly compromised: boolean;
    }
  | {
      mode: "attach";
      meta: LockMetadata;
    };

/** Thrown when port is held by an unrelated process. Non-fatal to this
 *  module; caller decides (exit with message / retry / override). */
export class InstanceLockMismatchError extends Error {
  readonly meta: LockMetadata;
  readonly observedIdentity: string | null;
  readonly code = "E_INSTANCE_MISMATCH";
  constructor(meta: LockMetadata, observedIdentity: string | null) {
    super(
      `Port ${meta.httpPort} is in use by an unrelated process (PID ${meta.pid}). ` +
        `Configure a different port or stop that process.`,
    );
    this.meta = meta;
    this.observedIdentity = observedIdentity;
  }
}

/**
 * Thrown when the recorded holder is alive but must not be taken over: it
 * holds its port without answering (`timeout`), or it is still starting and
 * has not bound yet (`starting`). The lock and the metadata are untouched.
 * `meta` is null when the holder has not written its record yet.
 * See change: harden-dashboard-start-detection (D5.6).
 */
export class InstanceLockUnresponsiveError extends Error {
  readonly meta: LockMetadata | null;
  readonly reason: "timeout" | "starting";
  readonly code = "E_INSTANCE_UNRESPONSIVE";
  constructor(meta: LockMetadata | null, reason: "timeout" | "starting") {
    super(
      reason === "timeout"
        ? `The dashboard holding this HOME${meta ? ` (PID ${meta.pid}, port ${meta.httpPort})` : ""} is alive but not responding. ` +
            "Not taking over its lock."
        : `The dashboard holding this HOME${meta ? ` (PID ${meta.pid}, port ${meta.httpPort})` : ""} is still starting. ` +
            "Not taking over its lock.",
    );
    this.meta = meta;
    this.reason = reason;
  }
}

export function isInstanceUnresponsiveError(err: unknown): err is InstanceLockUnresponsiveError {
  return !!err && typeof err === "object" && (err as { code?: string }).code === "E_INSTANCE_UNRESPONSIVE";
}

export interface AcquireConfig {
  httpPort: number;
  piPort: number;
  version: string;
  identity?: string;
  /** Host the server binds. Recorded as `bindHost` only when specific and non-loopback. */
  bindHost?: string | null;
  /** Called (once) when a successor takes this hold's lock over. Must not throw. */
  onCompromised?: () => void;
  /** Injection hooks for tests. Production callers pass no options. */
  hooks?: AcquireHooks;
}

/** One address's health answer, as `probeHealth` reports it. */
interface HealthProbeResult {
  running: boolean;
  pid?: number;
  /** The rendezvous instance id as published by `/api/health`. */
  instanceId?: string;
  /** Legacy field, read only for dashboards predating `instanceId`. */
  identity?: string;
  /** No definitive answer (every attempt timed out / reset). Absent on a refusal. */
  timedOut?: boolean;
}

export interface AcquireHooks {
  now?: () => number;
  hostname?: () => string;
  lockPath?: string;
  metaPath?: string;
  probeHealth?: (port: number, host?: string) => Promise<HealthProbeResult | null>;
  isProcessAlive?: (pid: number) => boolean;
  /** Sink for takeover / compromise notices. Default `console.warn`. */
  log?: (msg: string) => void;
  /** Stale threshold forwarded to `proper-lockfile`. Default 10s. */
  staleMs?: number;
}

// ──────────────────────────────────────────────────────────
// Paths
// ──────────────────────────────────────────────────────────

/**
 * Canonical HOME directory.
 *
 * Uses `os.userInfo().homedir` in preference to `os.homedir()` because on
 * POSIX the latter honors the `$HOME` environment variable (Node docs say:
 * "On POSIX, it uses the `$HOME` environment variable if defined"), which
 * the design (§4) explicitly prohibits — a GUI-launched process and a
 * shell-launched process would otherwise disagree on "where HOME is".
 * `userInfo().homedir` consults `getpwuid(3)` on POSIX, immune to `$HOME`.
 *
 * On Windows, both APIs ultimately use `USERPROFILE`, so the Git Bash
 * drift case (`$HOME=/c/Users/R` vs `USERPROFILE=C:\Users\R`) is handled
 * either way; keeping `userInfo().homedir` first is still correct.
 *
 * Result is then passed through `fs.realpathSync` to collapse symlinks,
 * FileVault migrations, and other canonicalization drift. Tolerant: falls
 * back to the raw path if realpath fails.
 */
export function canonicalHomedir(): string {
  let raw: string;
  try {
    raw = os.userInfo().homedir;
  } catch {
    raw = os.homedir();
  }
  try {
    return fs.realpathSync(raw);
  } catch {
    return raw;
  }
}

/**
 * Lock file path. This is what `proper-lockfile` locks.
 *
 * Rooted on `dashboard-paths.ts` — the `$HOME`-*honouring* root — rather than
 * `canonicalHomedir()`, which is deliberately `$HOME`-immune. The rendezvous
 * record and the gateway socket MUST share one root: two homes would give the
 * temp-`HOME` isolated-verification workflow an isolated socket but a shared
 * lock, which is the cross-talk that workflow exists to prevent (D2, task
 * 2.0b). `canonicalHomedir` stays exported and used by the `$HOME`-drift
 * reasoning elsewhere.
 */
export function getLockPath(homedir?: string): string {
  return homedir === undefined
    ? path.join(getDashboardConfigDir(), "server.lock")
    : path.join(homedir, ".pi", "dashboard", "server.lock");
}

/**
 * Metadata sidecar path (`<lockPath>.meta.json`).
 */
export function getMetaPath(lockPath: string = getLockPath()): string {
  return `${lockPath}.meta.json`;
}

// ──────────────────────────────────────────────────────────
// Metadata I/O
// ──────────────────────────────────────────────────────────

/**
 * Atomically write the metadata sidecar via tmp + rename.
 * Never leaves a partial file visible.
 */
export function writeMetadataAtomic(meta: LockMetadata, metaPath: string = getMetaPath()): void {
  const dir = path.dirname(metaPath);
  fs.mkdirSync(dir, { recursive: true });
  // Exclusive create with an explicit mode: the tmp name is predictable, and
  // a plain write would follow a planted symlink and inherit the umask
  // (@review Audit, minor).
  const tmpPath = `${metaPath}.tmp-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  fs.writeFileSync(tmpPath, JSON.stringify(meta, null, 2), { mode: 0o600, flag: "wx" });
  fs.renameSync(tmpPath, metaPath);
}

/**
 * Read the metadata sidecar. Returns null on any failure (missing, corrupt,
 * permission-denied). Callers MUST treat null as "assume stale."
 */
export function readMetadata(metaPath: string = getMetaPath()): LockMetadata | null {
  try {
    const raw = fs.readFileSync(metaPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isLockMetadata(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isLockMetadata(value: unknown): value is LockMetadata {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.pid === "number" &&
    typeof m.httpPort === "number" &&
    typeof m.piPort === "number" &&
    typeof m.startedAt === "number" &&
    typeof m.identity === "string" &&
    typeof m.version === "string" &&
    typeof m.url === "string"
  );
}

/**
 * Why a record could not be read. "Absent" and "unreadable" are NOT the same
 * thing: `readMetadata` collapses both to `null`, and `null` is treated as
 * stale — so a live holder whose sidecar is momentarily unreadable can be
 * stolen from (defect B2). Absent permits takeover; unreadable fails loudly;
 * a truncated or otherwise invalid record is treated as absent, because a
 * partially-written record must never be partially trusted (D15).
 *
 * See change: add-pi-gateway-transport-identity (task 2.0i, test-plan E10/E11).
 */
export type MetadataRead =
  | { status: "ok"; meta: LockMetadata }
  | { status: "absent" }
  | { status: "invalid"; detail: string }
  | { status: "unreadable"; detail: string };

/** Read the sidecar, distinguishing absent from unreadable from invalid. */
export function readMetadataDetailed(metaPath: string = getMetaPath()): MetadataRead {
  let raw: string;
  try {
    raw = fs.readFileSync(metaPath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { status: "absent" };
    return { status: "unreadable", detail: code ?? String(err) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Truncated mid-JSON, e.g. a crash during a non-atomic write by an older
    // version. Absent, never partially trusted.
    return { status: "invalid", detail: "record is not valid JSON" };
  }
  if (!isLockMetadata(parsed)) return { status: "invalid", detail: "record is missing fields" };
  return { status: "ok", meta: parsed };
}

/**
 * Remove the metadata sidecar. Silent on any error (missing is fine).
 */
export function removeMetadata(metaPath: string = getMetaPath()): void {
  try {
    fs.unlinkSync(metaPath);
  } catch {
    /* ignore */
  }
}

// ──────────────────────────────────────────────────────────
// Liveness
// ──────────────────────────────────────────────────────────

/** A freshly recorded holder has not bound its port yet (it records the lock first). */
export const HOLDER_START_GRACE_MS = 30_000;

/** Addresses a holder's health is probed on: both loopbacks, plus `bindHost` when recorded. */
function holderProbeHosts(meta: LockMetadata): string[] {
  const hosts = ["127.0.0.1", "::1"];
  if (meta.bindHost && !hosts.includes(meta.bindHost)) hosts.push(meta.bindHost);
  return hosts;
}

export type HolderVerdict =
  | "alive-match"
  | "alive-mismatch"
  | "alive-unresponsive"
  | "alive-starting"
  | "dead";

/**
 * Determine if the recorded lock holder is a responsive, identity-matching
 * dashboard. Returns:
 *   - `"alive-match"`: attach to it
 *   - `"alive-mismatch"`: someone else is on that port
 *   - `"alive-unresponsive"`: pid alive, port held but silent — never taken over
 *   - `"alive-starting"`: pid alive, every address refuses, `startedAt` within
 *     the start grace — it has not bound yet, never taken over
 *   - `"dead"`: pid gone, or alive but refusing past the grace (pid recycled)
 *
 * A refusal counts only when EVERY probed address refuses.
 * See change: harden-dashboard-start-detection (D5.5).
 */
export async function isLockHolderResponsive(
  meta: LockMetadata,
  hooks: Pick<AcquireHooks, "probeHealth" | "isProcessAlive" | "now"> = {},
): Promise<HolderVerdict> {
  const aliveCheck = hooks.isProcessAlive ?? isProcessAlive;
  if (!aliveCheck(meta.pid)) return "dead";

  const probe = hooks.probeHealth ?? defaultProbeHealth;
  const results = await Promise.all(
    // A probe that REJECTS is inconclusive, never a refusal: only a definitive
    // "nothing is listening" may lead to reclaiming a live pid's lock.
    holderProbeHosts(meta).map((host) =>
      probe(meta.httpPort, host).catch((): HealthProbeResult => ({ running: false, timedOut: true })),
    ),
  );

  const answers = results.filter((r): r is HealthProbeResult => !!r && r.running);
  if (answers.length > 0) {
    // Identity check: the rendezvous instance id is preferred; fall back to PID
    // match to stay compatible with older dashboards that predate it.
    //
    // `res.instanceId` is the field `/api/health` publishes (see
    // `instance-id.ts`); `res.identity` is only read for a dashboard predating
    // that rename. Reading a name the health route does not publish would fall
    // through to the PID branch and silently skip the verification entirely
    // (task 2.0e-i).
    const verdictOf = (res: HealthProbeResult): "alive-match" | "alive-mismatch" => {
      const published = res.instanceId ?? res.identity;
      if (published) return published === meta.identity ? "alive-match" : "alive-mismatch";
      if (typeof res.pid === "number") return res.pid === meta.pid ? "alive-match" : "alive-mismatch";
      // Running but no verifiable identity — conservative: mismatch.
      return "alive-mismatch";
    };
    const verdicts = answers.map(verdictOf);
    return verdicts.includes("alive-match") ? "alive-match" : "alive-mismatch";
  }

  // Nothing answered. A silent (timed-out) address means the port may be held
  // by a frozen holder: never a refusal, never reclaimable.
  if (results.some((r) => r?.timedOut)) return "alive-unresponsive";

  const now = (hooks.now ?? Date.now)();
  return now - meta.startedAt < HOLDER_START_GRACE_MS ? "alive-starting" : "dead";
}

async function defaultProbeHealth(port: number, host: string = "127.0.0.1"): Promise<HealthProbeResult> {
  return isDashboardRunning(port, host, { timeoutMs: 2000, retries: 2 });
}

// ──────────────────────────────────────────────────────────
// Acquire
// ──────────────────────────────────────────────────────────

/** Loopback / wildcard hosts: no `bindHost` is recorded for them. */
const NON_SPECIFIC_HOSTS = new Set(["", "0.0.0.0", "::", "[::]", "localhost", "127.0.0.1", "::1", "[::1]"]);

function specificBindHost(host: string | null | undefined): string | undefined {
  const h = (host ?? "").trim();
  return NON_SPECIFIC_HOSTS.has(h) ? undefined : h;
}

function lockDirMtimeMs(lockDir: string): number | null {
  try {
    return fs.statSync(lockDir).mtimeMs;
  } catch {
    return null;
  }
}

function elocked(lockPath: string): Error {
  return Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED", file: lockPath });
}

/** How many times a takeover that loses a race re-reads the record and re-decides. */
const MAX_REDECISIONS = 5;

/**
 * Acquire the per-HOME lock, or fall back to attach semantics if a live
 * dashboard already holds it.
 *
 * Flow:
 *   1. Ensure `~/.pi/dashboard/` exists (proper-lockfile requires parent).
 *   2. Acquire `<lockPath>.lock` — only while that directory does not exist.
 *      `proper-lockfile` is never allowed to steal by file age: it would hand a
 *      frozen (`SIGSTOP`) holder's lock to a newcomer after 10 s with no
 *      liveness check at all.
 *      ↪ on success: write metadata, return { mode: "acquired", release }
 *      ↪ held: read metadata, take the liveness verdict
 *         - alive-match: return { mode: "attach", meta }
 *         - alive-mismatch: throw InstanceLockMismatchError
 *         - alive-unresponsive / alive-starting: throw InstanceLockUnresponsiveError
 *         - dead: compare-and-remove the lock directory, acquire, then claim
 *           the record under the new lock.
 *
 * See change: harden-dashboard-start-detection (D5).
 */
export async function acquireOrAttach(config: AcquireConfig): Promise<LockAcquireResult> {
  const hooks = config.hooks ?? {};
  const lockPath = hooks.lockPath ?? getLockPath();
  const metaPath = hooks.metaPath ?? getMetaPath(lockPath);
  const lockDir = `${lockPath}.lock`;
  const staleMs = hooks.staleMs ?? 10_000;
  // The lock library clamps `stale` to >= 2 s; a live holder refreshes the
  // directory every stale/2, so "not refreshed within the window" uses the same floor.
  const refreshWindowMs = Math.max(staleMs, 2000);
  const now = hooks.now ?? Date.now;
  const hostname = hooks.hostname ?? os.hostname;
  const log = hooks.log ?? ((m: string) => console.warn(m));
  const bindHost = specificBindHost(config.bindHost);
  const verdictHooks = { probeHealth: hooks.probeHealth, isProcessAlive: hooks.isProcessAlive, now };

  // Ensure the lock file's parent directory exists. proper-lockfile wants
  // either the target file (which it creates alongside as `<path>.lock/`)
  // or an existing file — we create an empty sentinel so the API is
  // deterministic.
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  if (!fs.existsSync(lockPath)) {
    try {
      fs.writeFileSync(lockPath, "# pi-dashboard per-HOME advisory lock\n", {
        mode: 0o600,
        flag: "wx",
      });
    } catch {
      /* raced with another starter — fine, we lock it below */
    }
  }

  const buildMeta = (): LockMetadata => ({
    pid: process.pid,
    ppid: process.ppid,
    httpPort: config.httpPort,
    piPort: config.piPort,
    startedAt: now(),
    identity: config.identity ?? randomUUID(),
    version: config.version,
    url: `http://localhost:${config.httpPort}`,
    hostname: hostname(),
    ...(bindHost ? { bindHost } : {}),
  });

  /**
   * Acquire the lock and claim the record.
   *
   * Never calls `lock()` while the lock directory exists: a directory created
   * after this check cannot be old enough for the library's internal
   * file-age steal, so the library can only ever create, never take over.
   *
   * `guard` runs while the lock is HELD but before the record is written — the
   * compare-and-swap point of a takeover (task 2.0h). Returning `"abandon"`
   * releases without touching the record and yields `null`.
   */
  const tryAcquire = async (
    guard?: (existing: LockMetadata | null) => Promise<"proceed" | "abandon">,
  ) => {
    if (fs.existsSync(lockDir)) throw elocked(lockPath);
    let compromised = false;
    let release: () => Promise<void>;
    try {
      release = await properLockfile.lock(lockPath, {
        stale: staleMs,
        retries: 0,
        // proper-lockfile uses realpath by default; we already pass a
        // realpath-based directory, so this is a no-op but kept explicit.
        realpath: false,
        // The default handler THROWS, crashing a holder that was frozen,
        // starved or taken over. Disarm instead: the record and the lock now
        // belong to the successor.
        onCompromised: (err: Error) => {
          compromised = true;
          log(
            `[home-lock] this process's lock on ${lockPath} was taken over (${err.message}); ` +
              "releasing nothing and no longer acting as the HOME default.",
          );
          try {
            config.onCompromised?.();
          } catch {
            /* a notification hook must never crash the process */
          }
        },
      });
    } catch (err) {
      // A racing takeover removed our freshly created directory before the
      // library finished probing it (ENOENT): we did not get the lock.
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") throw elocked(lockPath);
      throw err;
    }
    if (guard && (await guard(readMetadata(metaPath))) === "abandon") {
      try {
        await release();
      } catch {
        /* ignore */
      }
      return null;
    }
    const meta = buildMeta();
    writeMetadataAtomic(meta, metaPath);
    const releaseOnce = (() => {
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        // A compromised hold, or a record that already names another instance,
        // means the lock directory and the sidecar belong to a successor.
        // `release()` would rmdir the successor's lock directory.
        if (compromised) return;
        const current = readMetadata(metaPath);
        if (current && current.identity !== meta.identity) return;
        try {
          await release();
        } catch {
          /* ignore — lock may have been compromised */
        }
        removeMetadata(metaPath);
      };
    })();
    return {
      mode: "acquired" as const,
      meta,
      release: releaseOnce,
      get compromised() {
        return compromised;
      },
    };
  };

  /** The lock is held by someone else: attach, refuse, or take it over. */
  const resolveHeld = async (depth: number): Promise<LockAcquireResult> => {
    // A racing takeover can leave no lock directory at all (e.g. the library
    // rolled back a half-created one). Nothing held means nothing to take
    // over: acquire plainly, exactly like the first attempt.
    if (!fs.existsSync(lockDir)) {
      try {
        return (await tryAcquire()) as Extract<LockAcquireResult, { mode: "acquired" }>;
      } catch (err) {
        if (!isELocked(err)) throw err;
      }
    }
    // Concurrent-launch race: if two callers race, the winner writes the
    // metadata sidecar a few ms after acquiring. The loser hits ELOCKED
    // faster and can read the sidecar BEFORE the winner has written it.
    // Short-poll for metadata to land before concluding "no metadata = stale."
    //
    // The read goes through `readMetadataDetailed` — `readMetadata` collapses
    // EACCES/EIO to `null`, and `null` is treated as stale and force-stolen, so
    // a permissions blip on a LIVE holder's sidecar was enough to unlock its
    // lock, delete its record and rebind: two dashboards per HOME (defect B2,
    // @review Audit).
    let meta: LockMetadata | null = null;
    for (let i = 0; i < 20; i++) {
      const read = readMetadataDetailed(metaPath);
      if (read.status === "unreadable") {
        throw new Error(
          `pi-dashboard: the rendezvous record at ${metaPath} exists but is unreadable. ` +
            "Refusing to take over this HOME — a live dashboard may still hold it. " +
            "Fix the file's permissions, or stop the running dashboard and remove it.",
        );
      }
      if (read.status === "ok") {
        meta = read.meta;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }

    // The directory mtime observed BEFORE the verdict is the compare half of
    // the compare-and-remove below.
    const observedMtime = lockDirMtimeMs(lockDir);

    if (!meta) {
      // No record after 500 ms. A live winner refreshes the lock directory
      // every stale/2, so only a directory NOT refreshed within the window is
      // an abandoned one. A fresh directory is a winner that has acquired but
      // not yet written its record (e.g. a stalled event loop).
      if (observedMtime !== null && now() - observedMtime <= refreshWindowMs) {
        throw new InstanceLockUnresponsiveError(null, "starting");
      }
      return takeOver(null, observedMtime, depth);
    }

    const liveness = await isLockHolderResponsive(meta, verdictHooks);
    if (liveness === "alive-match") return { mode: "attach", meta };
    if (liveness === "alive-mismatch") throw new InstanceLockMismatchError(meta, null);
    if (liveness === "alive-unresponsive") throw new InstanceLockUnresponsiveError(meta, "timeout");
    if (liveness === "alive-starting") throw new InstanceLockUnresponsiveError(meta, "starting");
    return takeOver(meta, observedMtime, depth);
  };

  /**
   * Short-lived mutex around a takeover (`<lockPath>.takeover/`, created with
   * an atomic `mkdir`). Returns its release function, or `null` when another
   * starter's takeover is still running after a bounded wait — the caller then
   * re-reads the record, which that starter has by then claimed. A mutex left
   * behind by a crashed starter is removed once it is older than the stale window.
   */
  const acquireTakeoverMutex = async (): Promise<(() => void) | null> => {
    const mutexDir = `${lockPath}.takeover`;
    for (let i = 0; i < 80; i++) {
      try {
        fs.mkdirSync(mutexDir);
        return () => fs.rmSync(mutexDir, { recursive: true, force: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
      const mtime = lockDirMtimeMs(mutexDir);
      if (mtime !== null && now() - mtime > refreshWindowMs) {
        fs.rmSync(mutexDir, { recursive: true, force: true });
        continue;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    return null;
  };

  /**
   * Take the lock over from a holder judged dead — ACQUIRE THEN VERIFY (task
   * 2.0h, defect B2), with the removal made explicit.
   *
   * `proper-lockfile.unlock()` only acts on locks held IN THIS PROCESS, so it
   * cannot remove a dead holder's lock; the old code only ever reclaimed
   * through the library's own file-age steal, after 10 s. We remove the
   * directory ourselves, only if it is unchanged since the verdict, and then
   * acquire it normally. The record is only claimed once we hold the lock, and
   * only if it still names the holder we observed dead (or is gone / itself
   * dead). If it has moved on to a live owner, we abandon and take the attach
   * path.
   */
  const takeOver = async (
    observed: LockMetadata | null,
    observedMtime: number | null,
    depth: number,
  ): Promise<LockAcquireResult> => {
    const redecide = (): Promise<LockAcquireResult> => {
      if (depth >= MAX_REDECISIONS) throw new InstanceLockUnresponsiveError(readMetadata(metaPath), "starting");
      return resolveHeld(depth + 1);
    };

    // Takeovers are serialized: two starters that observed the same dead
    // holder must not each remove the lock directory the other just created
    // (it would leave the winner holding a record but no lock).
    const releaseMutex = await acquireTakeoverMutex();
    if (!releaseMutex) return redecide();

    // `"retry"` = lost a race; the mutex is released BEFORE re-deciding, or the
    // nested decision would wait on a mutex this call still holds.
    let stolen: Awaited<ReturnType<typeof tryAcquire>> | "retry";
    try {
      // Compare: the directory and the record must both still be what the
      // verdict was about. A racer that already replaced either is a live winner.
      if (lockDirMtimeMs(lockDir) !== observedMtime || readMetadata(metaPath)?.identity !== observed?.identity) {
        stolen = "retry";
      } else {
        fs.rmSync(lockDir, { recursive: true, force: true });
        try {
          stolen = await tryAcquire(async (existing) => {
            if (existing?.identity === observed?.identity) return "proceed";
            if (!existing) {
              // No record while we hold the lock. Either the holder we observed dead
              // never wrote one, or a live winner has acquired and not yet written
              // its sidecar (@review Audit, minor — the same family as B2). Only the
              // first is ours to claim, and it is distinguishable: a live winner
              // holds the lock, so we could not be here.
              return "proceed";
            }
            // The record changed under us. Only a *dead* successor may be replaced.
            return (await isLockHolderResponsive(existing, verdictHooks)) === "dead" ? "proceed" : "abandon";
          });
        } catch (err) {
          // Lost the race for the fresh directory: someone else holds it now.
          if (!isELocked(err)) throw err;
          stolen = "retry";
        }
      }
    } finally {
      releaseMutex();
    }
    if (stolen === "retry") return redecide();
    if (stolen) return stolen;

    const current = readMetadata(metaPath);
    if (!current) throw new InstanceLockUnresponsiveError(observed, "starting");
    const currentLiveness = await isLockHolderResponsive(current, verdictHooks);
    if (currentLiveness === "alive-mismatch") throw new InstanceLockMismatchError(current, null);
    if (currentLiveness === "alive-match") return { mode: "attach", meta: current };
    throw new InstanceLockUnresponsiveError(current, currentLiveness === "alive-unresponsive" ? "timeout" : "starting");
  };

  try {
    return (await tryAcquire()) as Extract<LockAcquireResult, { mode: "acquired" }>;
  } catch (err: unknown) {
    if (!isELocked(err)) throw err;
    return resolveHeld(0);
  }
}

function isELocked(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "ELOCKED";
}

// ──────────────────────────────────────────────────────────
// Escape hatch
// ──────────────────────────────────────────────────────────

/**
 * True when the user has opted out of the per-HOME lock. Caller should
 * log a warning and skip acquireOrAttach when set.
 */
export function isLockDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.PI_DASHBOARD_ALLOW_MULTIPLE;
  return raw === "1" || raw === "true";
}

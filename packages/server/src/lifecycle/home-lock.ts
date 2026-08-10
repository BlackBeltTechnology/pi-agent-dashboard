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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import properLockfile from "proper-lockfile";
import { isDashboardRunning } from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";
import { isProcessAlive } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";

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
}

/** Result of `acquireOrAttach`. Callers branch on `mode`. */
export type LockAcquireResult =
  | {
      mode: "acquired";
      meta: LockMetadata;
      /** Release the lock + remove the metadata sidecar. Idempotent. */
      release: () => Promise<void>;
    }
  | {
      mode: "attach";
      meta: LockMetadata;
    };

/** Thrown when port is held by an unrelated process. Non-fatal to this
 *  module; caller decides (exit with message / retry / override). */
export class InstanceLockMismatchError extends Error {
  readonly code = "E_INSTANCE_MISMATCH";
  constructor(readonly meta: LockMetadata, readonly observedIdentity: string | null) {
    super(
      `Port ${meta.httpPort} is in use by an unrelated process (PID ${meta.pid}). ` +
        `Configure a different port or stop that process.`,
    );
  }
}

export interface AcquireConfig {
  httpPort: number;
  piPort: number;
  version: string;
  identity?: string;
  /** Injection hooks for tests. Production callers pass no options. */
  hooks?: AcquireHooks;
}

export interface AcquireHooks {
  now?: () => number;
  hostname?: () => string;
  lockPath?: string;
  metaPath?: string;
  probeHealth?: (port: number) => Promise<{ running: boolean; pid?: number; identity?: string } | null>;
  isProcessAlive?: (pid: number) => boolean;
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
 */
export function getLockPath(homedir: string = canonicalHomedir()): string {
  return path.join(homedir, ".pi", "dashboard", "server.lock");
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
  const tmpPath = `${metaPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(meta, null, 2));
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

/**
 * Determine if the recorded lock holder is a responsive, identity-matching
 * dashboard. Returns:
 *   - `"alive-match"`: attach to it
 *   - `"alive-mismatch"`: someone else is on that port
 *   - `"dead"`: treat as stale, proceed to acquire
 */
export async function isLockHolderResponsive(
  meta: LockMetadata,
  hooks: Pick<AcquireHooks, "probeHealth" | "isProcessAlive"> = {},
): Promise<"alive-match" | "alive-mismatch" | "dead"> {
  const aliveCheck = hooks.isProcessAlive ?? isProcessAlive;
  if (!aliveCheck(meta.pid)) return "dead";

  const probe = hooks.probeHealth ?? defaultProbeHealth;
  const res = await probe(meta.httpPort);
  if (!res || !res.running) return "dead";

  // Identity check: `identity` field is preferred; fall back to PID match
  // to stay compatible with older dashboards that predate identity.
  if (res.identity) {
    return res.identity === meta.identity ? "alive-match" : "alive-mismatch";
  }
  if (typeof res.pid === "number") {
    return res.pid === meta.pid ? "alive-match" : "alive-mismatch";
  }
  // Running but no verifiable identity — conservative: mismatch.
  return "alive-mismatch";
}

async function defaultProbeHealth(port: number) {
  const status = await isDashboardRunning(port);
  if (!status.running) return { running: false };
  // `isDashboardRunning` doesn't expose identity today. Re-fetch to peek at
  // the full health body for the `identity` field. Best-effort.
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const body = (await res.json()) as { pid?: number; identity?: string };
      return { running: true, pid: body.pid, identity: body.identity };
    }
  } catch {
    /* fall through */
  }
  return { running: true, pid: status.pid };
}

// ──────────────────────────────────────────────────────────
// Acquire
// ──────────────────────────────────────────────────────────

/**
 * Acquire the per-HOME lock, or fall back to attach semantics if a live
 * dashboard already holds it.
 *
 * Flow:
 *   1. Ensure `~/.pi/dashboard/` exists (proper-lockfile requires parent).
 *   2. `proper-lockfile.lock(path, { stale, retries: 0 })`
 *      ↪ on success: write metadata, return { mode: "acquired", release }
 *      ↪ on ELOCKED: read metadata, check liveness
 *         - dead: steal via `proper-lockfile.lock({ realpath:false, stale: 0 })`
 *                 (Note: proper-lockfile already does stale-stealing when
 *                 `stale` is configured — we just retry once.)
 *         - alive-match: return { mode: "attach", meta }
 *         - alive-mismatch: throw InstanceLockMismatchError
 */
export async function acquireOrAttach(config: AcquireConfig): Promise<LockAcquireResult> {
  const hooks = config.hooks ?? {};
  const lockPath = hooks.lockPath ?? getLockPath();
  const metaPath = hooks.metaPath ?? getMetaPath(lockPath);
  const staleMs = hooks.staleMs ?? 10_000;
  const now = hooks.now ?? Date.now;
  const hostname = hooks.hostname ?? os.hostname;

  // Ensure the lock file's parent directory exists. proper-lockfile wants
  // either the target file (which it creates alongside as `<path>.lock/`)
  // or an existing file — we create an empty sentinel so the API is
  // deterministic.
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  if (!fs.existsSync(lockPath)) {
    fs.writeFileSync(lockPath, "# pi-dashboard per-HOME advisory lock\n");
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
  });

  const tryAcquire = async () => {
    const release = await properLockfile.lock(lockPath, {
      stale: staleMs,
      retries: 0,
      // proper-lockfile uses realpath by default; we already pass a
      // realpath-based directory, so this is a no-op but kept explicit.
      realpath: false,
    });
    const meta = buildMeta();
    writeMetadataAtomic(meta, metaPath);
    const releaseOnce = (() => {
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          await release();
        } catch {
          /* ignore — lock may have been compromised */
        }
        removeMetadata(metaPath);
      };
    })();
    return { mode: "acquired" as const, meta, release: releaseOnce };
  };

  try {
    return await tryAcquire();
  } catch (err: unknown) {
    if (!isELocked(err)) throw err;
    // Someone else holds the lock. Decide: attach or error.
    //
    // Concurrent-launch race: if two callers race, the winner writes the
    // metadata sidecar a few ms after acquiring. The loser hits ELOCKED
    // faster and can read the sidecar BEFORE the winner has written it.
    // Short-poll for metadata to land before concluding "no metadata = stale."
    let meta: LockMetadata | null = null;
    for (let i = 0; i < 20; i++) {
      meta = readMetadata(metaPath);
      if (meta) break;
      await new Promise(r => setTimeout(r, 25));
    }
    if (!meta) {
      // Truly no metadata after 500ms → assume stale/corrupt. Force steal.
      removeMetadata(metaPath);
      try {
        return await tryAcquire();
      } catch (err2) {
        if (!isELocked(err2)) throw err2;
        try {
          await properLockfile.unlock(lockPath, { realpath: false });
        } catch {
          /* ignore */
        }
        return await tryAcquire();
      }
    }

    const liveness = await isLockHolderResponsive(meta, hooks);
    if (liveness === "alive-match") {
      return { mode: "attach", meta };
    }
    if (liveness === "alive-mismatch") {
      throw new InstanceLockMismatchError(meta, null);
    }
    // Dead holder — steal.
    try {
      await properLockfile.unlock(lockPath, { realpath: false });
    } catch {
      /* ignore */
    }
    removeMetadata(metaPath);
    return await tryAcquire();
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

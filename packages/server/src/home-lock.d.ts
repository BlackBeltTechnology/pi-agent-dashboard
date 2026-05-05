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
export type LockAcquireResult = {
    mode: "acquired";
    meta: LockMetadata;
    /** Release the lock + remove the metadata sidecar. Idempotent. */
    release: () => Promise<void>;
} | {
    mode: "attach";
    meta: LockMetadata;
};
/** Thrown when port is held by an unrelated process. Non-fatal to this
 *  module; caller decides (exit with message / retry / override). */
export declare class InstanceLockMismatchError extends Error {
    readonly meta: LockMetadata;
    readonly observedIdentity: string | null;
    readonly code = "E_INSTANCE_MISMATCH";
    constructor(meta: LockMetadata, observedIdentity: string | null);
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
    probeHealth?: (port: number) => Promise<{
        running: boolean;
        pid?: number;
        identity?: string;
    } | null>;
    isProcessAlive?: (pid: number) => boolean;
    /** Stale threshold forwarded to `proper-lockfile`. Default 10s. */
    staleMs?: number;
}
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
export declare function canonicalHomedir(): string;
/**
 * Lock file path. This is what `proper-lockfile` locks.
 */
export declare function getLockPath(homedir?: string): string;
/**
 * Metadata sidecar path (`<lockPath>.meta.json`).
 */
export declare function getMetaPath(lockPath?: string): string;
/**
 * Atomically write the metadata sidecar via tmp + rename.
 * Never leaves a partial file visible.
 */
export declare function writeMetadataAtomic(meta: LockMetadata, metaPath?: string): void;
/**
 * Read the metadata sidecar. Returns null on any failure (missing, corrupt,
 * permission-denied). Callers MUST treat null as "assume stale."
 */
export declare function readMetadata(metaPath?: string): LockMetadata | null;
/**
 * Remove the metadata sidecar. Silent on any error (missing is fine).
 */
export declare function removeMetadata(metaPath?: string): void;
/**
 * Determine if the recorded lock holder is a responsive, identity-matching
 * dashboard. Returns:
 *   - `"alive-match"`: attach to it
 *   - `"alive-mismatch"`: someone else is on that port
 *   - `"dead"`: treat as stale, proceed to acquire
 */
export declare function isLockHolderResponsive(meta: LockMetadata, hooks?: Pick<AcquireHooks, "probeHealth" | "isProcessAlive">): Promise<"alive-match" | "alive-mismatch" | "dead">;
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
export declare function acquireOrAttach(config: AcquireConfig): Promise<LockAcquireResult>;
/**
 * True when the user has opted out of the per-HOME lock. Caller should
 * log a warning and skip acquireOrAttach when set.
 */
export declare function isLockDisabled(env?: NodeJS.ProcessEnv): boolean;

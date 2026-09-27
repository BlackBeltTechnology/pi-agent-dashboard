/**
 * Path-parameterised locked JSON file primitives: proper-lockfile lock with an
 * ELOCKED-only bounded retry, 0600 placeholder create, checked read with
 * byte-exact corrupt-file quarantine, and atomic tmp+rename write.
 *
 * Extracted verbatim from provider-auth-storage.ts so auth.json and
 * plugin-credentials.json share ONE implementation. The quarantine dedup is
 * keyed by path: a dedup hit for one file must never vouch for a backup of
 * another. See change: expose-plugin-credential-and-oauth-seams (D1).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const _require = createRequire(import.meta.url);
const _lockfile = _require("proper-lockfile") as typeof import("proper-lockfile");

/**
 * Lock options, carried verbatim across the sync→async switch.
 *
 * `realpath: false` is load-bearing: the async `lock()` defaults it to `true`,
 * and resolving symlinks would have the dashboard and pi lock DIFFERENT
 * lockfiles on a symlinked home (docker volume, network mount) — silently
 * dropping the mutual exclusion this lock exists for.
 * See change: fix-provider-auth-lock-contention.
 */
const LOCK_OPTIONS = { stale: 10_000, realpath: false } as const;

/** Total window the lock-held condition is retried before the write fails. */
const LOCK_RETRY_BUDGET_MS = 2_000;

/**
 * Await between attempts. The cap matters more than the growth: several writers
 * queued behind one holder have to drain in sequence inside the budget.
 */
const LOCK_RETRY_BACKOFF_MS = [25, 50, 100] as const;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Acquire the lock on `filePath`, retrying ONLY the lock-already-held
 * condition (`ELOCKED`) for a bounded window.
 *
 * Deliberately NOT proper-lockfile's own `retries` option: its retry driver
 * re-runs on ANY truthy error, so an `EACCES`/`EPERM` would silently consume
 * the whole window before surfacing. Every other lock or I/O failure must
 * propagate immediately.
 *
 * The wait is an awaited timer, never `Atomics.wait`: a blocked event loop
 * would stall every HTTP request and WebSocket frame for the whole wait.
 * See change: fix-provider-auth-lock-contention.
 */
async function acquireLock(filePath: string): Promise<() => Promise<void>> {
  const deadline = Date.now() + LOCK_RETRY_BUDGET_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await _lockfile.lock(filePath, LOCK_OPTIONS);
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code !== "ELOCKED") throw err;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw err;
      const backoff = LOCK_RETRY_BACKOFF_MS[Math.min(attempt, LOCK_RETRY_BACKOFF_MS.length - 1)];
      await sleep(Math.min(backoff, remaining));
    }
  }
}

/**
 * Run `fn` while holding a proper-lockfile lock on `filePath`.
 * Ensures the file exists (lockfile requires the target to exist).
 */
export async function withLockedJsonFile<T>(filePath: string, fn: () => T | Promise<T>): Promise<T> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    // Create an empty file so lockfile can lock it. 0600 explicitly: without
    // it the placeholder lands at 0666 & ~umask (≈0644) and writeJsonAtomic's
    // permission preservation carries that onto every later write — the
    // credential file would be group/world-readable. See change:
    // fix-corrupt-auth-json-500.
    try { fs.writeFileSync(filePath, "{}\n", { flag: "wx", mode: 0o600 }); } catch { /* race-safe */ }
  }

  const release = await acquireLock(filePath);
  try {
    return await fn();
  } finally {
    // `release()` is a promise on the async API: an unlock failure
    // (`ERELEASED`, `EACCES`) must not surface as an unhandled rejection.
    // See change: fix-provider-auth-lock-contention.
    try { await release(); } catch { /* ignore cleanup errors */ }
  }
}

// ── Corrupt-content recovery ──────────────────────────────────────────
//
// Read tolerance and write safety are SPLIT: a read never fails on bad content
// (it quarantines a copy and returns {}), a write never destroys bytes it could
// not first copy aside. See change: fix-corrupt-auth-json-500.

/**
 * Result of a checked read. `quarantined: true` means a backup of these exact
 * bytes exists on disk — NOT that this call performed the copy.
 */
export interface CheckedJsonRead<T> {
  data: T;
  /** Bytes were readable but not a JSON plain object. */
  corrupt: boolean;
  /** A backup of these exact bytes exists on disk (this call, or a dedup hit). */
  quarantined: boolean;
}

/** In-process dedup of quarantined content: path → sha256 hex set, recorded only on a successful copy. */
const quarantinedBackups = new Map<string, Set<string>>();

/** Test seam: clear the quarantine dedup map between assertions. */
export function _resetQuarantineDedupForTests(): void {
  quarantinedBackups.clear();
}

/** `YYYYMMDDTHHMMSSsssZ` — sortable, millisecond precision, and NTFS-safe (no `:`). */
function quarantineStamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(".", "");
}

/**
 * Copy the bad bytes to `<file>.corrupt-<stamp>[-N]` and report success.
 *
 * The bytes WRITTEN are the exact bytes that were read and hashed — never a
 * fresh re-read of the file (another process may replace it in between). It is
 * a COPY, never a rename (read→rename is a TOCTOU against an atomic replace).
 * `wx` never overwrites an existing backup; on EEXIST a `-N` suffix is appended.
 * Mode 0600: truncated credential files usually still contain intact secrets.
 *
 * Returns true also on a DEDUP HIT for THIS path. The hash is recorded only
 * after a successful write so a failed write is retried, never latched.
 */
function quarantineCorruptFile(filePath: string, bytes: Buffer, logTag: string): boolean {
  const digest = createHash("sha256").update(bytes).digest("hex");
  let seen = quarantinedBackups.get(filePath);
  if (seen?.has(digest)) return true;

  const name = path.basename(filePath);
  const base = `${filePath}.corrupt-${quarantineStamp()}`;
  let target = base;
  for (let n = 1; ; n++) {
    try {
      fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
    } catch (caught) {
      const err = caught as NodeJS.ErrnoException | null;
      if (err?.code === "EEXIST") { target = `${base}-${n}`; continue; }
      // A failed exclusive create can leave an empty/partial file behind;
      // remove it so the retry reuses the same name instead of stacking -N.
      try { fs.unlinkSync(target); } catch { /* best-effort cleanup */ }
      console.warn(`[${logTag}] Could not quarantine corrupt ${name}: write ${target} failed:`, err?.message ?? err);
      return false;
    }
    if (!seen) { seen = new Set(); quarantinedBackups.set(filePath, seen); }
    seen.add(digest);
    // One announcement: path + reason. Never the file's contents.
    console.warn(`[${logTag}] ${name} is corrupt (unparseable content); quarantined a byte-exact copy to ${target}`);
    return true;
  }
}

/** Parse with BOM tolerance; non-plain-object JSON is corrupt by definition. */
function parseJsonObject(raw: string, name: string): Record<string, unknown> {
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const parsed: unknown = JSON.parse(stripped);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError(`${name} content is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Checked read. Content failures (empty/truncated/non-object) never throw:
 * they quarantine the bytes and return `{}` with `corrupt: true`. Read
 * failures (EACCES, EISDIR, …) still throw. ENOENT → `{}`, corrupt: false.
 * Never creates the file.
 */
export function readJsonChecked<T extends object = Record<string, unknown>>(
  filePath: string,
  logTag = "locked-json",
): CheckedJsonRead<T> {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { data: {} as T, corrupt: false, quarantined: false };
    throw err;
  }
  try {
    return { data: parseJsonObject(bytes.toString("utf-8"), path.basename(filePath)) as T, corrupt: false, quarantined: false };
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    const quarantined = quarantineCorruptFile(filePath, bytes, logTag);
    return { data: {} as T, corrupt: true, quarantined };
  }
}

/** Write-path refusal reason. Names the file, never any credential material. */
export function corruptUnbackedRefusal(filePath: string): Error {
  return new Error(
    `Refusing to write credentials: ${filePath} is corrupt and could not be backed up. ` +
    `Fix or remove the file manually, then try again.`,
  );
}

/**
 * Atomic tmp+rename write. Preserves the existing mode with group/world bits
 * cleared, or 0600 for a new file; `forceMode` overrides (corrupt-file repair).
 */
export function writeJsonAtomic(filePath: string, data: unknown, forceMode?: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp";
  const content = JSON.stringify(data, null, 2) + "\n";

  let mode = 0o600;
  if (forceMode !== undefined) {
    mode = forceMode;
  } else {
    try {
      mode = fs.statSync(filePath).mode & 0o777 & 0o700;
    } catch { /* file doesn't exist yet */ }
  }

  fs.writeFileSync(tmp, content, { mode });
  // writeFileSync's mode applies only at CREATION: a surviving .tmp from a
  // crashed earlier write would keep its mode through the rename.
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, filePath);
}

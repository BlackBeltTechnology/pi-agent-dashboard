/**
 * Folder-backed reference work-source.
 *
 * Available items are plain files under `dir`. A lease atomically renames the
 * file into `dir/inflight/<token>/<name>` (rename = the fence: whichever call
 * wins the rename owns the lease). The item handed to the child is the
 * in-flight path; the idempotency key derives from the STABLE original file
 * name, so a redelivery after expiry carries the same key.
 *
 * Lease lifecycle:
 *   - `next(n)` first reclaims EXPIRED and ORPHANED leases (moves the file back
 *     to `dir` and forgets the token, so the original child's later ack/nack is
 *     a stale no-op), then leases up to `n` available files. Reclaim scans the
 *     `inflight/` dir on disk, so a token left behind by a PRIOR process (the
 *     in-memory lease map is empty after restart) is recovered too — a crash
 *     never strands an item as permanently leased.
 *   - `ack(token)` deletes the in-flight file permanently (token current only).
 *   - `nack(token)` moves it back to `dir` (token current only).
 *
 * Return-to-pool never deletes a file it means to preserve: if the move back
 * fails (e.g. a same-named item already re-appeared), the in-flight file is
 * left in place for a later reclaim rather than discarded.
 *
 * The clock is injected (`now`) so tests can advance past the visibility
 * timeout deterministically.
 *
 * See change: automation-work-source-fanout.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LeasedHandle, WorkSource } from "../shared/work-source.js";

export interface FolderWorkSourceOptions {
  /** Directory whose files are the available work items. */
  dir: string;
  /** Lease visibility timeout (ms). A lease not acked within it auto-releases. */
  visibilityTimeoutMs?: number;
  /** Injectable clock (epoch ms). Defaults to `Date.now`. */
  now?: () => number;
}

interface Lease {
  token: string;
  /** Stable original file name — the item identity (drives the idempotency key). */
  fileName: string;
  /** Current path inside `inflight/<token>/`. */
  inflightPath: string;
  expiresAt: number;
}

const DEFAULT_VISIBILITY_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 16-hex idempotency key that is STABLE across redeliveries of the SAME file
 * yet DISTINCT for a different file that later reuses the same name. Derived
 * from name + size + mtime: a rename (lease / return-to-pool) preserves size
 * and mtime, so a redelivered item keeps its key, while a freshly-created file
 * with a reused name gets a new mtime and therefore a new key — a downstream
 * action that dedups on the key will not skip genuinely new work.
 */
function keyForFile(fileName: string, size: number, mtimeMs: number): string {
  return crypto
    .createHash("sha256")
    .update(`${fileName}\u0000${size}\u0000${Math.trunc(mtimeMs)}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Exactly ONE live source instance may own a given `dir`: the lease map is
 * in-memory, so a second concurrent instance on the same directory would treat
 * the first's valid leases as orphans and steal them. The plugin enforces this
 * by constructing one source per registry id (and rejecting duplicate dirs at
 * the config boundary). See change: automation-work-source-fanout.
 */
export function createFolderWorkSource(opts: FolderWorkSourceOptions): WorkSource<string> {
  const dir = path.resolve(opts.dir);
  const inflightRoot = path.join(dir, "inflight");
  const now = opts.now ?? (() => Date.now());
  const rawTimeout = opts.visibilityTimeoutMs;
  if (rawTimeout !== undefined && (!Number.isFinite(rawTimeout) || rawTimeout <= 0)) {
    throw new Error(
      `createFolderWorkSource: visibilityTimeoutMs must be a positive finite number, got ${rawTimeout}`,
    );
  }
  const timeout = rawTimeout ?? DEFAULT_VISIBILITY_TIMEOUT_MS;
  const leases = new Map<string, Lease>();
  let counter = 0;

  function ensureDirs(): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(inflightRoot, { recursive: true });
  }

  /**
   * Move every file inside a lease dir back to the available pool, then remove
   * the dir if it emptied. A file whose name is already taken in the pool is
   * LEFT in place (no data loss) for a later reclaim.
   */
  function moveLeaseDirBackToPool(leaseDir: string): void {
    let files: string[];
    try {
      files = fs.readdirSync(leaseDir);
    } catch {
      return;
    }
    for (const f of files) {
      const dest = path.join(dir, f);
      if (fs.existsSync(dest)) continue; // name re-appeared — leave for a later sweep
      try {
        fs.renameSync(path.join(leaseDir, f), dest);
      } catch {
        /* leave the file in place */
      }
    }
    try {
      if (fs.readdirSync(leaseDir).length === 0) fs.rmdirSync(leaseDir);
    } catch {
      /* ignore — non-empty (a preserved file) or already gone */
    }
  }

  /**
   * Reclaim EXPIRED (in-memory lease past its timeout) and ORPHANED (a token
   * dir on disk with no live in-memory lease — e.g. left by a crashed prior
   * process) leases, returning their items to the pool. Scans `inflight/` on
   * disk so restart recovery needs no persisted lease state.
   */
  function reclaim(): void {
    const t = now();
    let tokens: string[];
    try {
      tokens = fs
        .readdirSync(inflightRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return;
    }
    for (const token of tokens) {
      const lease = leases.get(token);
      if (lease && lease.expiresAt > t) continue; // still a valid lease — keep held
      moveLeaseDirBackToPool(path.join(inflightRoot, token));
      leases.delete(token);
    }
  }

  ensureDirs();
  reclaim(); // recover any inflight items orphaned by a prior process

  function next(n: number): LeasedHandle<string>[] {
    ensureDirs();
    reclaim();
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const available = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
    const handles: LeasedHandle<string>[] = [];
    for (const fileName of available) {
      if (handles.length >= n) break;
      const token = `${now()}-${counter++}`;
      const leaseDir = path.join(inflightRoot, token);
      const inflightPath = path.join(leaseDir, fileName);
      try {
        fs.mkdirSync(leaseDir, { recursive: true });
        fs.renameSync(path.join(dir, fileName), inflightPath); // fence
      } catch {
        try {
          fs.rmSync(leaseDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        continue; // lost the rename race — skip this file
      }
      const lease: Lease = { token, fileName, inflightPath, expiresAt: now() + timeout };
      leases.set(token, lease);
      // Stat after the fence so size/mtime reflect the leased file (rename
      // preserves both, keeping the key stable across redelivery).
      let size = 0;
      let mtimeMs = 0;
      try {
        const st = fs.statSync(inflightPath);
        size = st.size;
        mtimeMs = st.mtimeMs;
      } catch {
        /* fall back to name-only identity */
      }
      handles.push({
        item: inflightPath,
        leaseToken: token,
        idempotencyKey: keyForFile(fileName, size, mtimeMs),
      });
    }
    return handles;
  }

  /**
   * True when the token is not the current lease OR has passed its visibility
   * timeout. An expired token is fenced like a stale one: its item is returned
   * to the pool (expiry returns the item independently of any ack/nack) and the
   * requested action is a no-op, so a slow child can neither drop nor recall an
   * item it no longer owns.
   */
  function fenceExpired(leaseToken: string): boolean {
    const lease = leases.get(leaseToken);
    if (!lease) return true; // unknown/already-reclaimed → no-op
    if (lease.expiresAt <= now()) {
      moveLeaseDirBackToPool(path.join(inflightRoot, leaseToken));
      leases.delete(leaseToken);
      return true; // expired → item returned, requested action no-op
    }
    return false;
  }

  function ack(leaseToken: string): void {
    if (fenceExpired(leaseToken)) return; // stale/expired → no-op (never drops)
    try {
      fs.rmSync(path.join(inflightRoot, leaseToken), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    leases.delete(leaseToken); // deletes the in-flight file permanently
  }

  function nack(leaseToken: string): void {
    if (fenceExpired(leaseToken)) return; // stale/expired → no-op (already returned)
    moveLeaseDirBackToPool(path.join(inflightRoot, leaseToken));
    leases.delete(leaseToken);
  }

  return { next, ack, nack };
}

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
 *   - `next(n)` first reclaims expired leases (moves the file back to `dir` and
 *     forgets the token, so the original child's later ack/nack is a stale
 *     no-op), then leases up to `n` available files.
 *   - `ack(token)` deletes the in-flight file permanently (token current only).
 *   - `nack(token)` moves it back to `dir` (token current only).
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

/** 16-hex idempotency key stable across redeliveries of the same item id. */
function keyForFile(fileName: string): string {
  return crypto.createHash("sha256").update(fileName).digest("hex").slice(0, 16);
}

export function createFolderWorkSource(opts: FolderWorkSourceOptions): WorkSource<string> {
  const dir = path.resolve(opts.dir);
  const inflightRoot = path.join(dir, "inflight");
  const now = opts.now ?? (() => Date.now());
  const timeout = opts.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS;
  const leases = new Map<string, Lease>();
  let counter = 0;

  function ensureDirs(): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(inflightRoot, { recursive: true });
  }

  function forget(lease: Lease): void {
    try {
      fs.rmSync(path.dirname(lease.inflightPath), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    leases.delete(lease.token);
  }

  function returnToPool(lease: Lease): void {
    const dest = path.join(dir, lease.fileName);
    try {
      if (fs.existsSync(lease.inflightPath)) fs.renameSync(lease.inflightPath, dest);
    } catch {
      /* ignore */
    }
    forget(lease);
  }

  /** Reclaim expired leases before vending: item returns to the pool. */
  function reclaimExpired(): void {
    const t = now();
    for (const lease of [...leases.values()]) {
      if (lease.expiresAt <= t) returnToPool(lease);
    }
  }

  function next(n: number): LeasedHandle<string>[] {
    ensureDirs();
    reclaimExpired();
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
      handles.push({ item: inflightPath, leaseToken: token, idempotencyKey: keyForFile(fileName) });
    }
    return handles;
  }

  function ack(leaseToken: string): void {
    const lease = leases.get(leaseToken);
    if (!lease) return; // stale/expired → no-op
    forget(lease); // deletes the in-flight file permanently
  }

  function nack(leaseToken: string): void {
    const lease = leases.get(leaseToken);
    if (!lease) return; // stale/expired → no-op
    returnToPool(lease);
  }

  return { next, ack, nack };
}

/**
 * Temp-file cache for pi-image-fit.
 *
 * Spec: Temp-file cache.
 *
 * Layout:
 *   <os.tmpdir()>/pi-image-fit/<sessionScope>/<hash><ext>
 *
 * <ext> is chosen by the resize step per the format-adaptive policy
 * (`.png` for PNG inputs, `.jpg` for other inputs). The cache helpers
 * are extension-agnostic — callers pass the extension explicitly.
 *
 * Cache key = SHA-256 of `${absPath}|${mtimeMs}|${maxEdge}|${maxBytes}|${quality}`.
 * Session scope = sessionId when available, else `pid-<process.pid>`.
 * Cleanup: full session-scope directory removed on session_shutdown;
 * orphan sweep on extension load removes any dir under pi-image-fit/
 * whose mtime is older than 24 h.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export const ROOT_DIR = path.join(os.tmpdir(), "pi-image-fit");

export interface CacheKeyInput {
  absPath: string;
  /** Source file's mtime in ms (Date.getTime() or stat.mtimeMs). */
  mtimeMs: number;
  maxEdge: number;
  maxBytes: number;
  quality: number;
}

/**
 * Pure deterministic hash of the inputs that affect output bytes.
 * Identical inputs → identical hash.
 */
export function cacheKey(input: CacheKeyInput): string {
  const material = [
    input.absPath,
    String(input.mtimeMs),
    String(input.maxEdge),
    String(input.maxBytes),
    String(input.quality),
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}

export interface CacheScope {
  /** Absolute path of this session's cache directory. */
  dir: string;
  /**
   * Absolute path of the cache file for the given key.
   * `ext` MUST include the leading dot (e.g. `.png`, `.jpg`).
   */
  filePath(hash: string, ext: string): string;
}

export function scopeFor(sessionScope: string): CacheScope {
  const dir = path.join(ROOT_DIR, sanitize(sessionScope));
  return {
    dir,
    filePath: (hash, ext) => path.join(dir, `${hash}${ext}`),
  };
}

function sanitize(s: string): string {
  // Drop anything not [A-Za-z0-9_-] (notably `.` and `/`, which would
  // allow path traversal); collapse runs of `_`; trim leading/trailing
  // `_`; fall back to "default" when nothing usable remains.
  let out = s.replace(/[^A-Za-z0-9_-]/g, "_");
  out = out.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return out.slice(0, 96) || "default";
}

/** Best-effort: ensure the directory exists. */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Returns true if a cache file exists for `hash` with the given extension.
 * Any fs error is treated as "no cache hit" — the caller will rebuild.
 */
export async function hasCached(scope: CacheScope, hash: string, ext: string): Promise<boolean> {
  try {
    const st = await fs.stat(scope.filePath(hash, ext));
    return st.isFile();
  } catch {
    return false;
  }
}

/**
 * Remove this session's cache directory.
 * Best-effort; errors are reported via `warn` and swallowed.
 */
export async function cleanupSession(
  scope: CacheScope,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): Promise<void> {
  try {
    await fs.rm(scope.dir, { recursive: true, force: true });
  } catch (err) {
    warn(`[pi-image-fit] WARN cleanupSession failed for ${scope.dir}: ${stringifyErr(err)}`);
  }
}

/**
 * Sweep the cache root for stale session directories.
 * Best-effort; errors swallowed-and-logged.
 *
 * @param maxAgeMs entries with mtime older than this are removed
 * @param now      injectable clock for tests
 */
export async function cleanupOrphans(
  maxAgeMs: number = 24 * 60 * 60 * 1000,
  now: () => number = Date.now,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(ROOT_DIR);
  } catch {
    // Root doesn't exist yet — nothing to clean.
    return;
  }
  const threshold = now() - maxAgeMs;
  await Promise.all(
    entries.map(async (name) => {
      const full = path.join(ROOT_DIR, name);
      try {
        const st = await fs.stat(full);
        if (st.mtimeMs < threshold) {
          await fs.rm(full, { recursive: true, force: true });
        }
      } catch (err) {
        warn(`[pi-image-fit] WARN cleanupOrphans failed for ${full}: ${stringifyErr(err)}`);
      }
    }),
  );
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// Content-hash cache (context-seam path)
//
// A bounded in-memory LRU keyed by SHA-256 of the source bytes + policy, used
// by the `context` handler so a repeated oversize historical image is fitted
// once and served from memory on every later turn. Distinct from the temp-file
// cache above (which stays dedicated to the `read`-path seam and writes files);
// this one never touches the filesystem. Spec/Design: D3.
// ---------------------------------------------------------------------------

/** Default cache byte budget: ~64 MiB of resized image bytes. */
export const DEFAULT_CONTENT_CACHE_BUDGET = 64 * 1024 * 1024;

export interface ContentEntry {
  /** base64-encoded resized image bytes. */
  data: string;
  /** mime type of the resized bytes (mime-derived output format). */
  mimeType: string;
}

interface ContentPolicy {
  maxEdge: number;
  maxBytes: number;
  quality: number;
}

/**
 * Bounded, LRU content-hash cache. Keyed by SHA-256 of
 * `${base64}|${mimeType}|${maxEdge}|${maxBytes}|${quality}` — `mimeType` is
 * part of the key because the output format is mime-derived, so two blocks
 * with identical bytes but different declared mime must not collide.
 * Evicts least-recently-used entries once the summed resized-byte cost
 * exceeds `byteBudget`.
 */
export class ContentCache {
  private readonly map = new Map<string, { entry: ContentEntry; cost: number }>();
  private currentBytes = 0;

  constructor(private readonly byteBudget: number = DEFAULT_CONTENT_CACHE_BUDGET) {}

  /** Content hash for a block under the given policy. */
  keyFor(base64: string, mimeType: string, p: ContentPolicy): string {
    const material = [base64, mimeType, String(p.maxEdge), String(p.maxBytes), String(p.quality)].join("|");
    return createHash("sha256").update(material).digest("hex");
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  /** Look up, refreshing LRU recency on a hit. */
  get(key: string): ContentEntry | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    // Refresh recency: delete + re-insert moves the key to the newest slot.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.entry;
  }

  /** Insert (or replace), then evict LRU entries until within budget. */
  set(key: string, entry: ContentEntry): void {
    const cost = estimateBase64Bytes(entry.data);
    const existing = this.map.get(key);
    if (existing) {
      this.currentBytes -= existing.cost;
      this.map.delete(key);
    }
    this.map.set(key, { entry, cost });
    this.currentBytes += cost;
    // Evict least-recently-used (Map iteration order = oldest first) until
    // within budget. Keep at least the just-inserted entry.
    for (const oldest of this.map.keys()) {
      if (this.currentBytes <= this.byteBudget || this.map.size <= 1) break;
      const victim = this.map.get(oldest);
      if (!victim) break;
      this.currentBytes -= victim.cost;
      this.map.delete(oldest);
    }
  }

  /** Number of cached entries (test observability). */
  get size(): number {
    return this.map.size;
  }

  /** Summed resized-byte cost of cached entries (test observability). */
  get bytes(): number {
    return this.currentBytes;
  }
}

/** Decoded byte size of a base64 string (LRU cost accounting). */
function estimateBase64Bytes(b64: string): number {
  const len = b64.length;
  if (len === 0) return 0;
  let padding = 0;
  if (b64.charCodeAt(len - 1) === 0x3d) padding++;
  if (len > 1 && b64.charCodeAt(len - 2) === 0x3d) padding++;
  return Math.floor((len * 3) / 4) - padding;
}

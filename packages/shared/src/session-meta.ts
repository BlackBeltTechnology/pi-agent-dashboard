import fs from "node:fs";
import path from "node:path";

/**
 * Session metadata stored as a sidecar `.meta.json` file
 * next to the session's `.jsonl` file.
 *
 * Contains dashboard-owned per-session state and cached stats.
 * All fields are optional — a minimal `{ source: "dashboard" }` is valid.
 */
export interface SessionMeta {
  // Dashboard-owned (user-set via UI)
  source?: string;
  name?: string;
  attachedProposal?: string | null;
  hidden?: boolean;

  // Cached identity & state (from .jsonl header / bridge)
  cwd?: string;
  status?: string;
  /**
   * Per-session unread bit; mirrors `DashboardSession.unread`. Persists across
   * server restarts so an unread session stays unread until viewed.
   * See change: session-card-unread-stripes.
   */
  unread?: boolean;
  startedAt?: number;
  endedAt?: number;
  firstMessage?: string;

  // Cached stats (extracted from .jsonl, avoids re-parsing)
  model?: string;
  thinkingLevel?: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  contextTokens?: number;
  contextWindow?: number;

  // Cache freshness — compared against .jsonl mtime
  cachedAt?: number;
}

/**
 * Derive the `.meta.json` path from a `.jsonl` session file path.
 */
export function metaPath(sessionFile: string): string {
  const dir = path.dirname(sessionFile);
  const base = path.basename(sessionFile, ".jsonl");
  return path.join(dir, `${base}.meta.json`);
}

/**
 * Read session metadata from the sidecar file.
 * Returns undefined if the file doesn't exist or is invalid.
 */
export function readSessionMeta(sessionFile: string): SessionMeta | undefined {
  try {
    const content = fs.readFileSync(metaPath(sessionFile), "utf-8");
    return JSON.parse(content) as SessionMeta;
  } catch {
    return undefined;
  }
}

/**
 * Write session metadata to the sidecar file.
 * Creates parent directories if needed.
 * Uses atomic write (write-to-tmp + rename) to prevent corruption.
 */
export function writeSessionMeta(sessionFile: string, meta: SessionMeta): void {
  const p = metaPath(sessionFile);
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = p + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(meta, null, 2) + "\n");
  fs.renameSync(tmpPath, p);
}

/**
 * Merge new fields into an existing `.meta.json` sidecar.
 * Reads the existing file, merges with the provided partial,
 * and writes atomically. Fields in `partial` overwrite existing ones.
 * Preserves any unknown fields already in the file.
 */
export function mergeSessionMeta(sessionFile: string, partial: Partial<SessionMeta>): void {
  const existing = readSessionMeta(sessionFile) ?? {};
  const merged = { ...existing, ...partial };
  writeSessionMeta(sessionFile, merged);
}

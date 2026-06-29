import fs from "node:fs";
import path from "node:path";
import type { DisplayPrefs, PartialDisplayPrefs } from "./display-prefs.js";

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

  /**
   * Base ref used to create this session's git worktree. Set ONLY when
   * the session was spawned via the dashboard's worktree dialog (the
   * only call site that knows the base ref). Sessions spawned by other
   * means (CLI `pi`, manual `git worktree add`, etc.) SHALL NOT have
   * this field.
   *
   * Composed into `DashboardSession.gitWorktree.base` at broadcast time
   * when the bridge reports `gitWorktree` for the same session.
   *
   * See change: add-worktree-spawn-dialog.
   */
  gitWorktreeBase?: string;

  /**
   * Worktree parentage persisted for cold-start session grouping. Mirrors
   * the grouping-relevant subset of `DashboardSession.gitWorktree`
   * (`mainPath` collapses the session under its parent repo via
   * `resolveSessionGroupPath`; `name` drives the worktree cluster key).
   * `base` is intentionally omitted here — it persists separately as
   * `gitWorktreeBase`. Absent for plain checkouts. Without this, a
   * rebooted worktree session falls back to its own cwd group, becomes an
   * all-ended unpinned group, and is hidden.
   * See change: fix-cold-start-worktree-session-grouping.
   */
  gitWorktree?: { mainPath?: string; name?: string };

  /**
   * Sparse per-session override for chat-view display preferences.
   * Deep-merged onto the global `DisplayPrefs` from `preferences.json`.
   * `undefined` (field absent) means "no override — use global".
   * See change: configurable-chat-display.
   */
  displayPrefsOverride?: PartialDisplayPrefs;

  /**
   * Per-session collapse state for the PROCESS subcard's background-
   * processes drawer. `undefined` (field absent) means "no stored
   * choice" — the drawer renders collapsed by default.
   * See change: persist-process-drawer-collapse.
   */
  processDrawerCollapsed?: boolean;

  /**
   * Session classification mirror of `DashboardSession.kind`. Only
   * `"automation"` is persisted (set by the automation-plugin run spawn).
   * See change: add-automation-plugin.
   */
  kind?: "automation";

  /**
   * Automation-run identity mirror of `DashboardSession.automationRun`.
   * Persisted so a run session restored on cold start keeps its automation
   * grouping + effective board visibility.
   * See change: add-automation-plugin.
   */
  automationRun?: { name: string; runId: string; visibility?: "hidden" | "shown" };

  /**
   * Owning goal id when this session was spawned under / linked to a
   * folder-scoped `GoalRecord`. Cleared on unlink / goal delete.
   * See change: add-goals-folder-page.
   */
  goalId?: string;

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

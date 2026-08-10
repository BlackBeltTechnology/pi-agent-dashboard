/**
 * Types for the session file diff API.
 */

/** A single edit operation (oldText → newText replacement) */
export interface EditOperation {
  oldText: string;
  newText: string;
}

/** An individual file change event extracted from session events */
export interface FileChangeEvent {
  /**
   * "edit" / "write" for real Write/Edit tool events; "tool" is the single
   * representative event synthesised for a file that was only *detected*
   * on disk (git-status / bash-artifact) with no Write/Edit event.
   */
  type: "edit" | "write" | "tool";
  /** Event timestamp (ms since epoch) */
  timestamp: number;
  /** Truncated assistant message preceding this change (reason/context) */
  message?: string;
  /** Edit operations (only for type "edit") */
  edits?: EditOperation[];
  /** Written content (only for type "write") */
  content?: string;
  /**
   * The originating tool call's id, threaded from `tool_execution_start`. Used
   * to lazily fetch the FULL untruncated payload from the session JSONL via
   * `GET /api/session-change/:sessionId/:toolCallId` when `truncated` is set.
   * See change: opt-in-out-of-cwd-session-diffs.
   */
  toolCallId?: string;
  /**
   * True when the in-memory event store trimmed this event's payload: `content`
   * ends with `…[truncated]` (>~4 KB) or the `edits` array collapsed (>20 ops,
   * dropped from this entry). The client upgrades to full fidelity via the
   * session-addressed endpoint. See change: opt-in-out-of-cwd-session-diffs.
   */
  truncated?: boolean;
}

/** A file entry with all its change events */
export interface FileDiffEntry {
  /** File path relative to cwd */
  path: string;
  /** Individual change events, ordered by timestamp */
  changes: FileChangeEvent[];
  /** Aggregate git diff (unified format) when available */
  gitDiff?: string;
  /**
   * Added lines vs HEAD from `git diff --numstat HEAD`. Absent for
   * non-git / git-error / binary files. Non-negative integer.
   */
  additions?: number;
  /**
   * Deleted lines vs HEAD from `git diff --numstat HEAD`. Absent for
   * non-git / git-error / binary files. Non-negative integer.
   */
  deletions?: number;
  /**
   * How the file entered the changed-file list (file-level, not per-event):
   * `write`/`edit` = a real tool event; `tool` = detected on disk only;
   * `mixed` = both a Write/Edit event AND on-disk detection.
   */
  origin?: "write" | "edit" | "tool" | "mixed";
  /**
   * Redacted, length-capped label of the Bash command that most likely
   * produced this file (attribution). Secrets stripped. Optional.
   */
  producedBy?: string;
  /** How the file was *detected* on disk. Independent of `producedBy`. */
  detectedVia?: "git-status" | "bash-artifact";
  /**
   * Reserved — always `true` in v1 (all rows are in-cwd, previewable via
   * `/api/session-file`). The deferred out-of-cwd follow-up sets `false`.
   */
  previewable?: boolean;
  /**
   * True when THIS session owns the file (Write/Edit event, Bash-token
   * attribution, or mtime inside a Bash execution window). Files without
   * ownership evidence go in `SessionDiffResponse.otherChanges` instead.
   */
  sessionOwned?: boolean;
}

/** Response from GET /api/session-diff */
export interface SessionDiffResponse {
  /** Changed files with their change events (owned by this session) */
  files: FileDiffEntry[];
  /**
   * Working-tree changes this session cannot claim (shared cwd: another
   * session, a manual edit, or a build touched them). Rendered under a
   * muted, collapsed group. Empty for worktree-isolated sessions.
   */
  otherChanges?: FileDiffEntry[];
  /** Whether the session cwd is a git repository */
  isGitRepo: boolean;
  /**
   * VCS regime used to compute the per-file diffs. Optional for
   * backwards compatibility.
   */
  vcsKind?: "git";
  /**
   * The literal revset / ref used as the diff base (e.g. "HEAD",
   * "@-", "fork_point(@, trunk())"). Optional.
   */
  diffBase?: string;
  /**
   * Human-readable label for `diffBase` (e.g. "HEAD"). Optional.
   */
  baseLabel?: string;
  /**
   * Sum of `additions` across all files with numstat counts. Absent for
   * non-git / git-error. Excludes binary/omitted files.
   */
  totalAdditions?: number;
  /**
   * Sum of `deletions` across all files with numstat counts. Absent for
   * non-git / git-error. Excludes binary/omitted files.
   */
  totalDeletions?: number;
}

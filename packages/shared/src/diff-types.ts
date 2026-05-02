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
  /** "edit" or "write" */
  type: "edit" | "write";
  /** Event timestamp (ms since epoch) */
  timestamp: number;
  /** Truncated assistant message preceding this change (reason/context) */
  message?: string;
  /** Edit operations (only for type "edit") */
  edits?: EditOperation[];
  /** Written content (only for type "write") */
  content?: string;
}

/** A file entry with all its change events */
export interface FileDiffEntry {
  /** File path relative to cwd */
  path: string;
  /** Individual change events, ordered by timestamp */
  changes: FileChangeEvent[];
  /** Aggregate git diff (unified format) when available */
  gitDiff?: string;
}

/** Response from GET /api/session-diff */
export interface SessionDiffResponse {
  /** Changed files with their change events */
  files: FileDiffEntry[];
  /** Whether the session cwd is a git repository */
  isGitRepo: boolean;
  /**
   * VCS regime used to compute the per-file diffs. Optional for
   * backwards compatibility — absent on responses produced before
   * change `add-jj-workspace-plugin`.
   */
  vcsKind?: "git" | "jj";
  /**
   * The literal revset / ref used as the diff base (e.g. "HEAD",
   * "@-", "fork_point(@, trunk())"). Optional.
   */
  diffBase?: string;
  /**
   * Human-readable label for `diffBase` (e.g. "develop", "trunk()",
   * "HEAD"). Optional. Renders as "Diffing against \<baseLabel\>"
   * in the client when `vcsKind === "jj"`.
   */
  baseLabel?: string;
}

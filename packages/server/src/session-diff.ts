/**
 * Session diff extraction — scans session events for file changes
 * and optionally enriches with git diffs.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute, sep as pathSep } from "node:path";
import * as git from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import * as jj from "@blackbelt-technology/pi-dashboard-shared/platform/jj.js";
import type { DashboardEvent, JjState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FileChangeEvent, FileDiffEntry, EditOperation } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { isGitRepo } from "./git-operations.js";

const GIT_TIMEOUT = 15_000;
const MAX_MESSAGE_LENGTH = 120;

const WRITE_EDIT_TOOLS = new Set(["write", "edit"]);

/**
 * Extract file change events from session events.
 * Scans tool_execution_start events for Write/Edit tools,
 * groups by file path, and includes preceding assistant message as context.
 */
export function extractFileChanges(events: DashboardEvent[], cwd: string): FileDiffEntry[] {
  const fileMap = new Map<string, FileChangeEvent[]>();
  let lastAssistantMessage: string | undefined;

  for (const event of events) {
    // Track most recent assistant message for context
    if (event.eventType === "message_end") {
      const msg = event.data.message as any;
      if (msg?.role === "assistant") {
        const content = Array.isArray(msg.content)
          ? msg.content
              .filter((c: any) => c?.type === "text")
              .map((c: any) => c.text)
              .join("")
          : typeof msg.content === "string" ? msg.content : "";
        if (content) {
          lastAssistantMessage = content.length > MAX_MESSAGE_LENGTH
            ? content.slice(0, MAX_MESSAGE_LENGTH) + "..."
            : content;
        }
      }
    }

    if (event.eventType !== "tool_execution_start") continue;

    const toolName = (event.data.toolName as string || "").toLowerCase();
    if (!WRITE_EDIT_TOOLS.has(toolName)) continue;

    const args = event.data.args as Record<string, unknown> | undefined;
    if (!args) continue;

    const rawPath = (args.path || args.file_path) as string | undefined;
    if (!rawPath) continue;

    // Resolve and filter paths outside cwd
    const filePath = normalizePath(rawPath, cwd);
    if (!filePath) continue;

    const changeEvent: FileChangeEvent = {
      type: toolName === "write" ? "write" : "edit",
      timestamp: event.timestamp,
      message: lastAssistantMessage,
    };

    if (toolName === "write") {
      changeEvent.content = args.content as string | undefined;
    } else {
      changeEvent.edits = args.edits as EditOperation[] | undefined;
    }

    const existing = fileMap.get(filePath);
    if (existing) {
      existing.push(changeEvent);
    } else {
      fileMap.set(filePath, [changeEvent]);
    }
  }

  // Build result, sorted by path, changes sorted by timestamp
  const result: FileDiffEntry[] = [];
  for (const [path, changes] of fileMap) {
    changes.sort((a, b) => a.timestamp - b.timestamp);
    result.push({ path, changes });
  }
  result.sort((a, b) => a.path.localeCompare(b.path));

  return result;
}

/**
 * Normalize a file path relative to cwd.
 * Returns null if the path is outside cwd.
 */
function normalizePath(rawPath: string, cwd: string): string | null {
  let absPath: string;
  if (isAbsolute(rawPath)) {
    absPath = rawPath;
  } else {
    absPath = resolve(cwd, rawPath);
  }

  // Check if the resolved path is inside cwd
  const rel = relative(cwd, absPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return null;
  }

  // Normalize to posix separators. These paths are embedded into git diff
  // headers (`diff --git a/<path> b/<path>`) which expect forward slashes,
  // and are also used by the client for display and URL construction.
  // See change: fix-windows-server-parity.
  return pathSep === "/" ? rel : rel.split(pathSep).join("/");
}

/**
 * Enrich file entries with git diff output.
 * Runs `git diff HEAD -- <path>` for each file when in a git repo.
 * Returns gracefully on any git errors.
 */
export function enrichWithGitDiff(
  cwd: string,
  files: FileDiffEntry[],
): { enrichedFiles: FileDiffEntry[]; isGitRepo: boolean } {
  let gitAvailable = false;
  try {
    gitAvailable = isGitRepo(cwd);
  } catch {
    return { enrichedFiles: files, isGitRepo: false };
  }

  if (!gitAvailable) {
    return { enrichedFiles: files, isGitRepo: false };
  }

  const enriched = files.map((file) => {
    try {
      // Delegate to the shared git tool module. The runner handles
      // windowsHide, timeout, argv-array escaping (no shell), and the
      // "no diff" exit-1 tolerance. See change: platform-command-executor.
      const diff = git.diffOr({ cwd, path: file.path }).trim();

      if (diff) {
        return { ...file, gitDiff: diff };
      }

      // No diff from HEAD — try untracked (new file)
      const status = git.statusPorcelainOr({ cwd, path: file.path }).trim();

      if (status.startsWith("??") || status.startsWith("A")) {
        // Untracked or newly added — generate synthetic diff.
        // Read via fs.readFileSync rather than `cat` for cross-platform
        // support (Windows has no `cat`). See change: fix-windows-server-parity.
        const absPath = resolve(cwd, file.path);
        if (!existsSync(absPath)) {
          return file;
        }
        const content = readFileSync(absPath, "utf-8");
        const lines = content.split("\n");
        const diffLines = [
          `diff --git a/${file.path} b/${file.path}`,
          "new file mode 100644",
          `--- /dev/null`,
          `+++ b/${file.path}`,
          `@@ -0,0 +1,${lines.length} @@`,
          ...lines.map((l) => `+${l}`),
        ];
        return { ...file, gitDiff: diffLines.join("\n") };
      }

      return file;
    } catch {
      return file;
    }
  });

  return { enrichedFiles: enriched, isGitRepo: true };
}

// ── jj enrichment (regime-aware) ─────────────────────────────────────────

/**
 * Pure helper: pick the right diff base for a given jj state.
 *   - default workspace  → `@-`     (equivalent to `git diff HEAD`)
 *   - non-default        → `fork_point(@, trunk())`
 *
 * Exported for unit testing without spawning jj.
 */
export function selectJjDiffBase(jjState: JjState | undefined): {
  diffBase: string;
  baseLabel: string;
} {
  const workspace = jjState?.workspaceName;
  if (!workspace || workspace === "default") {
    return { diffBase: "@-", baseLabel: "@-" };
  }
  // Use the `..` range form (always-supported) instead of `fork_point()`
  // (which changed signature across jj versions). `trunk()` returns the
  // most-recent ancestor on main/master/trunk; the diff base is the
  // single tip of trunk so that `--from <base> --to @` materializes the
  // cumulative diff across every agent commit in this workspace.
  return { diffBase: "trunk()", baseLabel: "trunk()" };
}

/**
 * Enrich file entries with `jj diff` output, regime-aware. Runs
 * `jj diff --from <baseRev> --to @ -- <path>` per file. Handles new
 * files natively (no synthetic `/dev/null` fallback needed — jj
 * reports new files in unified diff format directly).
 */
export function enrichWithJjDiff(
  cwd: string,
  files: FileDiffEntry[],
  jjState: JjState | undefined,
): { enrichedFiles: FileDiffEntry[]; vcsKind: "jj"; diffBase: string; baseLabel: string } {
  const { diffBase, baseLabel } = selectJjDiffBase(jjState);
  const labelOverride = resolveBaseLabel(cwd, diffBase, baseLabel);
  const enriched = files.map((file) => {
    try {
      const diff = jj.diffOr({
        cwd,
        fromRev: diffBase,
        toRev: "@",
        path: file.path,
      }).trim();
      if (diff) return { ...file, gitDiff: diff };
      return file;
    } catch {
      return file;
    }
  });
  return { enrichedFiles: enriched, vcsKind: "jj", diffBase, baseLabel: labelOverride };
}

/**
 * Promote the abstract revset (e.g. `@-` or `fork_point(@, trunk())`) to
 * a human-friendly bookmark name when one exists. Best effort — falls
 * back to the abstract label if jj can't resolve it.
 */
function resolveBaseLabel(cwd: string, diffBase: string, fallback: string): string {
  const result = jj.logRevset({
    cwd,
    revset: diffBase,
    template: 'bookmarks ++ "\\n"',
  });
  if (!result.ok) return fallback;
  const first = result.value.trim().split("\n")[0]?.trim();
  if (first && first.length > 0 && first.length < 100) return first;
  return fallback;
}

// ── Unified dispatcher ──────────────────────────────────────────────────

export interface VcsEnrichmentResult {
  enrichedFiles: FileDiffEntry[];
  isGitRepo: boolean;
  vcsKind?: "git" | "jj";
  diffBase?: string;
  baseLabel?: string;
}

/**
 * Regime-aware dispatcher. When the session has `jjState.isJjRepo`,
 * route through `enrichWithJjDiff` (which produces the cumulative diff
 * for non-default workspaces). Otherwise fall back to the existing
 * `enrichWithGitDiff` behavior unchanged — plain-git regime is byte-
 * equivalent to the pre-change response shape (modulo the now-optional
 * `vcsKind` field that older clients ignore).
 *
 * See change: add-jj-workspace-plugin.
 */
export function enrichWithVcsDiff(
  cwd: string,
  files: FileDiffEntry[],
  jjState: JjState | undefined,
): VcsEnrichmentResult {
  if (jjState?.isJjRepo) {
    const result = enrichWithJjDiff(cwd, files, jjState);
    return {
      enrichedFiles: result.enrichedFiles,
      isGitRepo: jjState.isColocated === true,
      vcsKind: "jj",
      diffBase: result.diffBase,
      baseLabel: result.baseLabel,
    };
  }
  const result = enrichWithGitDiff(cwd, files);
  return {
    ...result,
    vcsKind: result.isGitRepo ? "git" : undefined,
    diffBase: result.isGitRepo ? "HEAD" : undefined,
    baseLabel: result.isGitRepo ? "HEAD" : undefined,
  };
}

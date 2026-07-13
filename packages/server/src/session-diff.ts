/**
 * Session diff extraction — scans session events for file changes
 * and optionally enriches with git diffs.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute, sep as pathSep } from "node:path";
import * as git from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
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
 * Parse `git diff --numstat --relative HEAD` into a per-path line-count map.
 * Format per line: `<adds>\t<dels>\t<path>`. Binary rows report `-` for the
 * counts → that path is omitted (never emits a non-numeric value). This is a
 * NEW parser distinct from `parseShortstat` (which parses `--shortstat`
 * summary lines, a different format). See change: add-change-summary-table.
 */
export function gitNumstat(cwd: string): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>();
  let raw: string;
  try {
    raw = git.numstatOr({ cwd });
  } catch {
    return map;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [addStr, delStr] = parts;
    // Binary / unmergeable rows report `-` — omit rather than emit NaN.
    if (addStr === "-" || delStr === "-") continue;
    const additions = Number.parseInt(addStr, 10);
    const deletions = Number.parseInt(delStr, 10);
    if (!Number.isFinite(additions) || !Number.isFinite(deletions)) continue;
    // Path may itself contain tabs only under -z; here it is the tail join.
    const path = parts.slice(2).join("\t");
    map.set(path, { additions, deletions });
  }
  return map;
}

/**
 * Enrich file entries with git diff output.
 * Runs `git diff HEAD -- <path>` for each file when in a git repo, plus one
 * `git diff --numstat --relative HEAD` for per-file / aggregate line counts.
 * Returns gracefully on any git errors.
 */
export function enrichWithGitDiff(
  cwd: string,
  files: FileDiffEntry[],
): {
  enrichedFiles: FileDiffEntry[];
  isGitRepo: boolean;
  totalAdditions?: number;
  totalDeletions?: number;
} {
  let gitAvailable = false;
  try {
    gitAvailable = isGitRepo(cwd);
  } catch {
    return { enrichedFiles: files, isGitRepo: false };
  }

  if (!gitAvailable) {
    return { enrichedFiles: files, isGitRepo: false };
  }

  const numstatMap = gitNumstat(cwd);
  let totalAdditions = 0;
  let totalDeletions = 0;
  let anyCounts = false;

  const enriched = files.map((file) => {
    const counts = numstatMap.get(file.path);
    if (counts) {
      totalAdditions += counts.additions;
      totalDeletions += counts.deletions;
      anyCounts = true;
    }
    const withCounts: FileDiffEntry = counts
      ? { ...file, additions: counts.additions, deletions: counts.deletions }
      : file;
    try {
      // Delegate to the shared git tool module. The runner handles
      // windowsHide, timeout, argv-array escaping (no shell), and the
      // "no diff" exit-1 tolerance. See change: platform-command-executor.
      const diff = git.diffOr({ cwd, path: file.path }).trim();

      if (diff) {
        return { ...withCounts, gitDiff: diff };
      }

      // No diff from HEAD — try untracked (new file)
      const status = git.statusPorcelainOr({ cwd, path: file.path }).trim();

      if (status.startsWith("??") || status.startsWith("A")) {
        // Untracked or newly added — generate synthetic diff.
        // Read via fs.readFileSync rather than `cat` for cross-platform
        // support (Windows has no `cat`). See change: fix-windows-server-parity.
        const absPath = resolve(cwd, file.path);
        if (!existsSync(absPath)) {
          return withCounts;
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
        return { ...withCounts, gitDiff: diffLines.join("\n") };
      }

      return withCounts;
    } catch {
      return withCounts;
    }
  });

  return {
    enrichedFiles: enriched,
    isGitRepo: true,
    totalAdditions: anyCounts ? totalAdditions : undefined,
    totalDeletions: anyCounts ? totalDeletions : undefined,
  };
}

// ── Unified dispatcher ──────────────────────────────────────────────────

export interface VcsEnrichmentResult {
  enrichedFiles: FileDiffEntry[];
  isGitRepo: boolean;
  vcsKind?: "git";
  diffBase?: string;
  baseLabel?: string;
  totalAdditions?: number;
  totalDeletions?: number;
}

/**
 * Dispatcher over git diff enrichment. Wraps `enrichWithGitDiff` and
 * annotates the response with `vcsKind`/`diffBase`/`baseLabel` (optional
 * fields older clients ignore).
 */
export function enrichWithVcsDiff(
  cwd: string,
  files: FileDiffEntry[],
): VcsEnrichmentResult {
  const result = enrichWithGitDiff(cwd, files);
  return {
    ...result,
    vcsKind: result.isGitRepo ? "git" : undefined,
    diffBase: result.isGitRepo ? "HEAD" : undefined,
    baseLabel: result.isGitRepo ? "HEAD" : undefined,
  };
}

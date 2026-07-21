/**
 * DiffViewer — editor-pane tab rendering ONE file's diff (change:
 * add-change-summary-table).
 *
 * Opened under a virtual `diff:<relPath>` path (mirrors `live:<url>`) so it
 * coexists with a monaco tab of the same file. Reads the file's `gitDiff` from
 * the shared `SessionDiffProvider` (no per-tab fetch, design D5) and delegates
 * rendering to `DiffPanel` (the same `@git-diff-view/react` renderer the
 * takeover uses).
 */

import type { FileDiffEntry, SessionDiffResponse } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { t as i18nT } from "../../lib/i18n";
import { normalizeUnderCwd } from "../../lib/session-rel-path.js";
import { DiffPanel } from "../DiffPanel.js";
import { useOptionalSessionDiff } from "../SessionDiffContext.js";
import type { ViewerProps } from "./types.js";

/** Strip the `diff:` sentinel from a virtual viewer path. */
export function stripDiffPrefix(path: string): string {
  return path.startsWith("diff:") ? path.slice("diff:".length) : path;
}

/**
 * Resolve a file entry from session-diff data. Exact path match first; on miss
 * retry with cwd-normalized relative key (absolute tool paths). Also scans
 * `otherChanges`. See change: fix-session-diff-open-nongit-and-preview.
 */
export function findDiffFile(
  data: SessionDiffResponse | null | undefined,
  rawRelPath: string,
  cwd?: string | null,
): FileDiffEntry | undefined {
  if (!data) return undefined;
  const all: FileDiffEntry[] = data.otherChanges?.length
    ? [...data.files, ...data.otherChanges]
    : data.files;
  const exact = all.find((f) => f.path === rawRelPath);
  if (exact) return exact;
  const normalized = normalizeUnderCwd(rawRelPath, cwd);
  if (normalized !== rawRelPath) {
    return all.find((f) => f.path === normalized);
  }
  return undefined;
}

export default function DiffViewer({ path, cwd }: ViewerProps) {
  const rawRel = stripDiffPrefix(path);
  const ctx = useOptionalSessionDiff();

  if (!ctx) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--text-tertiary)] text-sm">
        {i18nT("common.diffUnavailable", undefined, "Diff unavailable")}
      </div>
    );
  }

  const { data, isLoading } = ctx;
  const file = findDiffFile(data, rawRel, cwd);
  const filePath = file?.path ?? normalizeUnderCwd(rawRel, cwd);

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--text-tertiary)] text-sm">
        {isLoading
          ? i18nT("status.loadingDiff", undefined, "Loading diff…")
          : i18nT("common.noChangesForFile", undefined, "No changes for this file")}
      </div>
    );
  }

  return (
    <DiffPanel
      file={file}
      selection={{ filePath, changeIndex: null }}
      sessionId={ctx.sessionId}
    />
  );
}

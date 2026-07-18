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

import { t as i18nT } from "../../lib/i18n/i18n.js";
import { normalizeUnderCwd } from "../../lib/util/normalize-path.js";
import { DiffPanel } from "../diff/DiffPanel.js";
import { useOptionalSessionDiff } from "../diff/SessionDiffContext.js";
import type { ViewerProps } from "./types.js";

/** Strip the `diff:` sentinel from a virtual viewer path. */
export function stripDiffPrefix(path: string): string {
  return path.startsWith("diff:") ? path.slice("diff:".length) : path;
}

export default function DiffViewer({ path, cwd }: ViewerProps) {
  const relPath = stripDiffPrefix(path);
  const ctx = useOptionalSessionDiff();

  if (!ctx) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--text-tertiary)] text-sm">
        {i18nT("common.diffUnavailable", undefined, "Diff unavailable")}
      </div>
    );
  }

  const { data, isLoading } = ctx;
  // Exact match first; on a miss retry with the cwd-normalized path
  // (belt-and-suspenders for any caller that opened an absolute `diff:` path).
  // See change: fix-session-diff-open-nongit-and-preview.
  const normPath = normalizeUnderCwd(relPath, cwd);
  const file =
    data?.files.find((f) => f.path === relPath) ??
    (normPath !== relPath ? data?.files.find((f) => f.path === normPath) : undefined);

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
      selection={{ filePath: file.path, changeIndex: null }}
      sessionId={ctx.sessionId}
      cwd={cwd}
    />
  );
}

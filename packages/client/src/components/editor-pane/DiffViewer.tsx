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

import { t as i18nT } from "../../lib/i18n";
import { DiffPanel } from "../DiffPanel.js";
import { useOptionalSessionDiff } from "../SessionDiffContext.js";
import type { ViewerProps } from "./types.js";

/** Strip the `diff:` sentinel from a virtual viewer path. */
export function stripDiffPrefix(path: string): string {
  return path.startsWith("diff:") ? path.slice("diff:".length) : path;
}

export default function DiffViewer({ path }: ViewerProps) {
  const relPath = stripDiffPrefix(path);
  const ctx = useOptionalSessionDiff();

  if (!ctx) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--text-tertiary)] text-sm">
        {i18nT("auto.diff_unavailable", undefined, "Diff unavailable")}
      </div>
    );
  }

  const { data, isLoading } = ctx;
  const file = data?.files.find((f) => f.path === relPath);

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--text-tertiary)] text-sm">
        {isLoading
          ? i18nT("auto.loading_diff", undefined, "Loading diff…")
          : i18nT("auto.no_changes_for_file", undefined, "No changes for this file")}
      </div>
    );
  }

  return (
    <DiffPanel
      file={file}
      selection={{ filePath: relPath, changeIndex: null }}
      sessionId={ctx.sessionId}
    />
  );
}

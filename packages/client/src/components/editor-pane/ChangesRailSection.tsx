/**
 * ChangesRailSection — the changed-files "Changes" section pinned atop the
 * editor-pane project-tree rail (change: add-change-summary-table).
 *
 * Reads the shared `SessionDiffProvider` (one fetch per session, design D5),
 * renders the merged roll-up header + per-file rows via `DiffFileTree`, and
 * opens a file's diff as a `diff:` viewer tab on row select. Collapsible with
 * its own scroll; expands + scrolls into view when `openChanges()` fires
 * (via the context `changesRevealSignal`). Absent when the session has no
 * changes.
 */
import { useEffect, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n";
import { DiffFileTree, type FileSelection } from "../DiffFileTree.js";
import { useOptionalSessionDiff } from "../SessionDiffContext.js";
import { useSplitWorkspace } from "../SplitWorkspaceContext.js";

export function ChangesRailSection({ activePath }: { activePath?: string | null }) {
  const diff = useOptionalSessionDiff();
  const { openDiffTab, changesRevealSignal } = useSplitWorkspace();
  const [expanded, setExpanded] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reveal (expand + scroll into view) when openChanges() fires. Skip the
  // initial mount value so it doesn't fight the user's collapse choice.
  const prevSignal = useRef(changesRevealSignal);
  useEffect(() => {
    if (changesRevealSignal !== prevSignal.current) {
      prevSignal.current = changesRevealSignal;
      setExpanded(true);
      containerRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [changesRevealSignal]);

  const files = diff?.data?.files ?? [];
  if (files.length === 0) return null;

  const isGitRepo = diff?.data?.isGitRepo ?? false;
  // Git session → numstat totals; non-git → the payload carries no counts, so
  // the header shows nothing extra (per-turn summed deltas live in the chat
  // block). `summed` flags the non-git aggregate when totals are derived.
  const totalAdditions = diff?.data?.totalAdditions;
  const totalDeletions = diff?.data?.totalDeletions;

  // Selecting a Changes row opens that file's diff tab (activePath tracks the
  // currently open diff tab under its virtual `diff:` path).
  const selection: FileSelection | null = activePath?.startsWith("diff:")
    ? { filePath: activePath.slice("diff:".length), changeIndex: null }
    : null;

  return (
    <div
      ref={containerRef}
      data-testid="changes-rail-section"
      className="flex min-h-0 shrink-0 flex-col border-b border-[var(--border-primary)]"
      style={{ maxHeight: expanded ? "45%" : undefined }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex shrink-0 items-center gap-1.5 px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
      >
        <span className="text-[var(--text-tertiary)]">{expanded ? "▾" : "▸"}</span>
        <span>{i18nT("auto.changes", undefined, "Changes")}</span>
        <span className="text-[var(--text-tertiary)]">({files.length})</span>
      </button>
      {expanded && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DiffFileTree
            files={files}
            selection={selection}
            onSelect={(sel) => openDiffTab(sel.filePath)}
            totalAdditions={totalAdditions}
            totalDeletions={totalDeletions}
            summed={!isGitRepo && totalAdditions !== undefined}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Per-turn inline change summary block (change: add-change-summary-table).
 *
 * Deterministic, client-side, no LLM: renders the files one assistant turn
 * changed with `+adds −dels` derived from Edit/Write event payloads. Default
 * expanded, collapses to a one-line `N files · +X −Y` summary. Row activation
 * calls `onOpenFile(path)` (opens the file's diff tab in the split pane).
 */
import { useState } from "react";
import type { TurnSummary } from "../lib/lineDelta.js";
import { CountBadges } from "./CountBadges.js";

export function ChangeSummaryBlock({
  summary,
  onOpenFile,
  defaultExpanded = true,
}: {
  summary: TurnSummary;
  onOpenFile?: (path: string) => void;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const fileCount = summary.files.length;
  if (fileCount === 0) return null;

  const header = (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      className="flex w-full items-center gap-2 px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded-t"
    >
      <span className="text-[var(--text-tertiary)]">{expanded ? "▾" : "▸"}</span>
      <span className="font-medium">
        {fileCount} file{fileCount === 1 ? "" : "s"}
      </span>
      <span className="text-[var(--text-tertiary)]">·</span>
      <CountBadges additions={summary.totalAdditions} deletions={summary.totalDeletions} />
      {!expanded && (
        <span className="ml-auto text-[var(--text-tertiary)] italic">Changed this turn</span>
      )}
    </button>
  );

  return (
    <div
      data-testid="change-summary-block"
      className="my-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-xs"
    >
      {header}
      {expanded && (
        <ul className="border-t border-[var(--border-subtle)]">
          {summary.files.map((file) => {
            const rowContent = (
              <>
                <span
                  className={
                    file.status === "added"
                      ? "text-[var(--accent-green)]"
                      : "text-[var(--text-tertiary)]"
                  }
                  aria-hidden
                >
                  {file.status === "added" ? "+" : "●"}
                </span>
                <span className="truncate font-mono text-[var(--text-primary)]" title={file.path}>
                  {file.path}
                </span>
                <span className="ml-auto pl-2">
                  <CountBadges additions={file.additions} deletions={file.deletions} />
                </span>
              </>
            );
            return (
              <li key={file.path}>
                {onOpenFile ? (
                  <button
                    type="button"
                    onClick={() => onOpenFile(file.path)}
                    className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-[var(--bg-hover)]"
                  >
                    {rowContent}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 px-2 py-1">{rowContent}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

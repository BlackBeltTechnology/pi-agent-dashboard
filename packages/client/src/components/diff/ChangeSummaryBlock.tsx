/**
 * Per-turn inline change summary block (change: add-change-summary-table).
 *
 * Deterministic, client-side, no LLM: renders the files one assistant turn
 * changed with `+adds −dels` derived from Edit/Write event payloads. Each row
 * leads with an extension-keyed mime icon (shared `fileIcon()` helper), not a
 * status glyph. Expanded state is derived from the file count (collapse at
 * `>= THRESHOLD`) until the user manually toggles — then their choice is sticky.
 * Row activation calls `onOpenFile(path)` (opens the file's diff tab).
 *
 * See change: improve-change-summary-block.
 */
import { Icon } from "@mdi/react";
import { useState } from "react";
import { fileIcon } from "../../lib/preview/file-icon.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import type { TurnSummary } from "../../lib/util/lineDelta.js";
import { CountBadges } from "../session/CountBadges.js";

/** Collapse the block once the changed-file count reaches this many files. */
const THRESHOLD = 8;

export function ChangeSummaryBlock({
  summary,
  onOpenFile,
  defaultExpanded = true,
}: {
  summary: TurnSummary;
  onOpenFile?: (path: string) => void;
  defaultExpanded?: boolean;
}) {
  const { t } = useI18n();
  // null = user has not toggled; derive from count. true/false = sticky choice.
  const [userChoice, setUserChoice] = useState<boolean | null>(null);
  const fileCount = summary.files.length;
  const expanded = userChoice ?? (defaultExpanded && fileCount < THRESHOLD);
  if (fileCount === 0) return null;

  const header = (
    <button
      type="button"
      onClick={() => setUserChoice(!expanded)}
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
        <span className="ml-auto text-[var(--text-tertiary)] italic">{t("diff.changedThisTurn", undefined, "Changed this turn")}</span>
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
            const icon = fileIcon(file.path);
            const rowContent = (
              <>
                <Icon path={icon.iconPath} size={0.55} className={icon.colorClass} />
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

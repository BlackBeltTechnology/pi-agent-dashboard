import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiArchiveOutline, mdiArrowRight, mdiFileDocumentOutline, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/**
 * Folder-card OpenSpec slot. Single-line navigation entry to the full-page
 * OpenSpec board (`/folder/:encodedCwd/openspec`). The inline collapsible
 * change tree, group pills, in-section search, and DnD moved to the board.
 *
 * See change: redesign-openspec-board (openspec-folder-section spec).
 */
interface Props {
  data: OpenSpecData;
  cwd: string;
  onRefresh: () => void;
  /** Navigate to the full-page board for this cwd. */
  onOpenBoard?: (cwd: string) => void;
  /** Open the specs browser overlay. */
  onOpenSpecs?: () => void;
  /** Open the archive browser overlay. */
  onOpenArchive?: () => void;
}

export function FolderOpenSpecSection({ data, cwd, onRefresh, onOpenBoard, onOpenSpecs, onOpenArchive }: Props) {
  // Pending state (cold boot) — show a spinner placeholder.
  if (!data.initialized && data.pending) {
    return (
      <div data-testid="folder-openspec-section-pending" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5 mt-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border border-[var(--text-tertiary)] border-t-transparent animate-spin"
            data-testid="folder-openspec-pending-spinner"
            aria-label={i18nT("openspec.openspecLoading", undefined, "OpenSpec loading")}
          />
          <span className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase">{i18nT("openspec.openspec", undefined, "OpenSpec")}</span>
        </div>
      </div>
    );
  }

  if (!data.initialized) return null;

  const count = data.changes.length;

  return (
    <div data-testid="folder-openspec-section" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 mt-1">
        <button
          data-testid="folder-openspec-open-board"
          onClick={(e) => { e.stopPropagation(); onOpenBoard?.(cwd); }}
          className="flex items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase hover:text-blue-400"
          title={i18nT("openspec.openOpenspecBoard", undefined, "Open OpenSpec board")}
        >
          <span>{i18nT("openspec.openspec2", undefined, "OpenSpec (")}{count})</span>
          <Icon path={mdiArrowRight} size={0.45} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRefresh(); }}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          title={i18nT("common.refresh", undefined, "Refresh")}
          data-testid="folder-openspec-refresh"
        >
          <Icon path={mdiRefresh} size={0.5} />
        </button>
        <span className="flex-1" />
        {onOpenArchive && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenArchive(); }}
            className="text-[10px] px-1.5 py-0.5 rounded border text-purple-400 border-purple-500/40 bg-purple-500/5 hover:text-purple-300 hover:border-purple-500/70"
            data-testid="folder-archive-btn"
          >
            <Icon path={mdiArchiveOutline} size={0.4} className="inline mr-0.5" />{i18nT("openspec.archive", undefined, "Archive")}
          </button>
        )}
        {onOpenSpecs && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenSpecs(); }}
            className="text-[10px] px-1.5 py-0.5 rounded border text-cyan-400 border-cyan-500/40 bg-cyan-500/5 hover:text-cyan-300 hover:border-cyan-500/70"
            data-testid="folder-specs-btn"
          >
            <Icon path={mdiFileDocumentOutline} size={0.4} className="inline mr-0.5" />{i18nT("openspec.specs", undefined, "Specs")}
          </button>
        )}
      </div>
    </div>
  );
}

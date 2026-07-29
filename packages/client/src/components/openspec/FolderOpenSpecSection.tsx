import { SlotPill } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { SlotPlacement } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiArchiveOutline, mdiClipboardTextOutline, mdiFileDocumentOutline, mdiPackageVariant, mdiRefresh } from "@mdi/js";
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
  placement?: SlotPlacement;
}

export function FolderOpenSpecSection({ data, cwd, onRefresh, onOpenBoard, onOpenSpecs, onOpenArchive, placement = "sidebar" }: Props) {
  const isMenu = placement === "menu";
  const menuLabel = i18nT("openspec.changes", undefined, "OpenSpec Changes");
  // Pending state (cold boot) — show a spinner placeholder.
  if (!data.initialized && data.pending) {
    return (
      <div data-testid="folder-openspec-section-pending" onClick={(e) => e.stopPropagation()}>
        <SlotPill
          surface={placement === "sidebar" ? "raised" : placement === "menu" ? "menu" : "flat"}
          glyph={isMenu ? mdiPackageVariant : mdiClipboardTextOutline}
          accent="purple"
          label={isMenu ? menuLabel : i18nT("openspec.openspec", undefined, "OpenSpec")}
          actions={
            <span
              className="inline-block h-3.5 w-3.5 rounded-full border-2 border-purple-400/30 border-t-purple-400 animate-spin"
              data-testid="folder-openspec-pending-spinner"
              role="status"
              aria-label={i18nT("openspec.openspecLoading", undefined, "OpenSpec loading")}
            />
          }
        >
          <span>{i18nT("openspec.openspecLoading", undefined, "Loading changes…")}</span>
        </SlotPill>
      </div>
    );
  }

  if (!data.initialized) return null;

  const count = data.changes.length;

  return (
    <div data-testid="folder-openspec-section" onClick={(e) => e.stopPropagation()}>
      <SlotPill
        surface={placement === "sidebar" ? "raised" : placement === "menu" ? "menu" : "flat"}
        glyph={isMenu ? mdiPackageVariant : mdiClipboardTextOutline}
        accent="purple"
        label={isMenu ? menuLabel : i18nT("openspec.openspec", undefined, "OpenSpec")}
        activateTestId="folder-openspec-open-board"
        activateTitle={i18nT("openspec.openOpenspecBoard", undefined, "Open OpenSpec board")}
        onActivate={() => onOpenBoard?.(cwd)}
        actions={!isMenu ? (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRefresh(); }}
              className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1"
              title={i18nT("common.refresh", undefined, "Refresh")}
              data-testid="folder-openspec-refresh"
            >
              <Icon path={mdiRefresh} size={0.5} />
            </button>
            {onOpenArchive && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenArchive(); }}
                className="text-purple-400 hover:text-purple-300 p-1"
                title={i18nT("openspec.archive", undefined, "Archive")}
                aria-label={i18nT("openspec.archive", undefined, "Archive")}
                data-testid="folder-archive-btn"
              >
                <Icon path={mdiArchiveOutline} size={0.5} />
              </button>
            )}
            {onOpenSpecs && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenSpecs(); }}
                className="text-cyan-400 hover:text-cyan-300 p-1"
                title={i18nT("openspec.specs", undefined, "Specs")}
                aria-label={i18nT("openspec.specs", undefined, "Specs")}
                data-testid="folder-specs-btn"
              >
                <Icon path={mdiFileDocumentOutline} size={0.5} />
              </button>
            )}
          </>
        ) : undefined}
      >
        <span data-testid="folder-openspec-count">{count}</span>
        <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">{i18nT("openspec.changesUnit", undefined, "changes")}</span>
      </SlotPill>
    </div>
  );
}

import { SlotPill } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiClipboardTextOutline } from "@mdi/js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/**
 * Folder-card OpenSpec slot. Single-line navigation entry to the full-page
 * OpenSpec board (`/folder/:encodedCwd/openspec`). The inline collapsible
 * change tree, group pills, in-section search, and DnD moved to the board.
 *
 * The section is STATE-ONLY. Its Refresh / Specs / Archive controls are items
 * in the folder actions menu, contributed HOST-side by `SessionList` — unlike
 * the plugin sections, OpenSpec's callbacks are already props owned by the very
 * component that renders the menu, so routing them through the plugin
 * contribution registry would be indirection for symmetry's sake.
 *
 * See change: redesign-openspec-board (openspec-folder-section spec);
 * move-slot-actions-to-menu.
 */
interface Props {
  data: OpenSpecData;
  cwd: string;
  /** Navigate to the full-page board for this cwd. */
  onOpenBoard?: (cwd: string) => void;
}

export function FolderOpenSpecSection({ data, cwd, onOpenBoard }: Props) {
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
      <SlotPill
        glyph={mdiClipboardTextOutline}
        accent="purple"
        label={i18nT("openspec.openspec", undefined, "OpenSpec")}
        activateTestId="folder-openspec-open-board"
        activateTitle={i18nT("openspec.openOpenspecBoard", undefined, "Open OpenSpec board")}
        onActivate={() => onOpenBoard?.(cwd)}
      >
        <span data-testid="folder-openspec-count">{count}</span>
        <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">{i18nT("openspec.changesUnit", undefined, "changes")}</span>
      </SlotPill>
    </div>
  );
}

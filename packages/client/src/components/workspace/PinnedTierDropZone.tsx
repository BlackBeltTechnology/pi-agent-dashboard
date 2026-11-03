/**
 * PinnedTierDropZone — eject target for a `workspace-folder` drag.
 *
 * Mounted by `SessionList`'s `WorkspaceFolderEjectZone`, which renders it for
 * EVERY `workspace-folder` drag (read from dnd-kit's `active`), whether or not
 * pinned groups are visible. Dropping on a pinned group ejects too; both
 * resolve to `{ kind: "move", toWorkspaceId: null }`, so the two targets never
 * conflict in outcome. Needs real geometry (min height), not a hairline, since
 * it is the only eject target when the pinned tier is empty or filtered away.
 *
 * See changes: drag-folders-across-workspaces, fix-sidebar-folder-visibility (D2).
 */
import { useDroppable } from "@dnd-kit/core";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { dropIndicatorProps, PINNED_TIER_MIN_HEIGHT_PX } from "../../lib/layout/sidebar-dnd.js";

/** Sentinel droppable id — namespaced so it cannot collide with a folder cwd or a `ws:` id. */
export const PINNED_TIER_DROP_ID = "__pinned_tier__";

export function PinnedTierDropZone() {
  const { setNodeRef, isOver } = useDroppable({
    id: PINNED_TIER_DROP_ID,
    data: { type: "pinned-tier" },
  });
  const indicator = dropIndicatorProps(isOver, false);

  return (
    <div
      ref={setNodeRef}
      style={{ minHeight: PINNED_TIER_MIN_HEIGHT_PX }}
      className={`flex items-center justify-center rounded-[14px] border border-dashed border-[var(--border-secondary)] text-[11px] text-[var(--text-muted)] ${indicator.className}`}
      data-over={indicator["data-over"]}
      data-testid="pinned-tier-drop-zone"
    >
      {i18nT("folders.dropToUnassign", undefined, "Drop here to remove from workspace")}
    </div>
  );
}

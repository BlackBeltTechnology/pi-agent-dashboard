/**
 * PinnedTierDropZone — eject target for a `workspace-folder` drag when the
 * pinned tier is EMPTY.
 *
 * Mounts outside the `visibleTopPinned.length > 0` gate in `SessionList`:
 * that gate renders nothing when the tier is empty, which is exactly when an
 * eject affordance is needed. Renders only while a `workspace-folder` drag is
 * active AND the tier is empty — rendering it alongside the pinned groups
 * would create two overlapping eject targets whose nearest-center resolution
 * is arbitrary. Being the sole affordance, it needs real geometry rather than
 * a zero-height hairline.
 *
 * See design D4 / change: drag-folders-across-workspaces.
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

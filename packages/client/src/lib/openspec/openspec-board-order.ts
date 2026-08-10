/**
 * Pure ordering helpers for the OpenSpec board (kanban).
 *
 * Two concerns:
 *   1. Default sort — deterministic fallback when no manual order exists:
 *      in-progress changes first, then everything else, then complete last,
 *      each tier tie-broken by name.
 *   2. Manual order merge — apply a persisted ordered `changeName[]` for a
 *      group, appending unordered changes per the default sort so newly
 *      created changes land deterministically without disturbing stored order.
 *
 * See change: redesign-openspec-board (openspec-change-order spec).
 */
import type { OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Tier rank for the default sort. Lower sorts first. */
function defaultRank(c: OpenSpecChange): number {
  if (c.status === "complete") return 2;
  if (c.status === "in-progress") return 0;
  return 1;
}

/** Deterministic default comparator: in-progress → others → complete, then name. */
export function defaultChangeSort(a: OpenSpecChange, b: OpenSpecChange): number {
  const ra = defaultRank(a);
  const rb = defaultRank(b);
  if (ra !== rb) return ra - rb;
  return a.name.localeCompare(b.name);
}

/**
 * Order a group's changes by an optional persisted `changeName[]`.
 *
 * Changes present in `order` render first, in that exact sequence. Changes
 * absent from `order` (newly created, or never reordered) append afterward
 * sorted by {@link defaultChangeSort}. Stale `order` entries whose change is
 * no longer in `changes` are ignored. Missing/empty `order` ⇒ pure default
 * sort (never throws).
 */
export function orderChangesForGroup(
  changes: OpenSpecChange[],
  order: string[] | undefined,
): OpenSpecChange[] {
  if (!order || order.length === 0) {
    return [...changes].sort(defaultChangeSort);
  }
  const byName = new Map(changes.map((c) => [c.name, c]));
  const ordered: OpenSpecChange[] = [];
  const seen = new Set<string>();
  for (const name of order) {
    const c = byName.get(name);
    if (c && !seen.has(name)) {
      ordered.push(c);
      seen.add(name);
    }
  }
  const rest = changes.filter((c) => !seen.has(c.name)).sort(defaultChangeSort);
  return [...ordered, ...rest];
}

/**
 * Compute the new persisted order array for a group after a drag drop.
 * `currentOrdered` is the group's changes in their current rendered order;
 * `movedName` is inserted at `targetIndex` (clamped). Returns the resulting
 * `changeName[]` to persist.
 */
export function computeReorder(
  currentOrderedNames: string[],
  movedName: string,
  targetIndex: number,
): string[] {
  const without = currentOrderedNames.filter((n) => n !== movedName);
  const idx = Math.max(0, Math.min(targetIndex, without.length));
  return [...without.slice(0, idx), movedName, ...without.slice(idx)];
}

// ── Drop-slot resolution (fix-openspec-board-drop-targeting) ──────────────
//
// One direction- and scope-independent rule replaces the old mixed-index-space
// arithmetic in `OpenSpecBoardView.handleDragEnd`. Everything below is pure so
// the rule is unit-testable without a DOM; the caller feeds dnd-kit's
// scroll-live droppable rects in.

/** Vertical extent of one rendered card, in the same space as the pointer Y. */
export type CardRect = { top: number; bottom: number };

/** Rendered card name → its scroll-live vertical extent. */
export type CardRectMap = Map<string, CardRect>;

/** A resolved drop slot: which column, and the without-moved insert index. */
export type DropSlot = { colKey: string; index: number };

/** What the pointer is over. `rail` forces the slot to the last position. */
export type DropTargetKind = "card" | "body" | "root" | "rail";

/** Droppable id prefix for a column's root element (header + outer padding). */
export const COL_ROOT_PREFIX = "col-root:";
/** Droppable id prefix for a column's drag-only append rail. */
export const RAIL_PREFIX = "rail:";

/**
 * Resolve the insert index for a pointer position by the midpoint rule.
 *
 * `index` = the number of cards in the target column — excluding the moved
 * card — whose rect midpoint is at or above `pointerY`. A pointer exactly at a
 * midpoint therefore resolves to the slot *after* that card.
 *
 * The result is an index into the **without-moved** list, which is exactly what
 * {@link computeReorder} consumes: no caller-side `+1` correction is ever
 * needed, for same-column or cross-column drags, upward or downward.
 *
 * Names with no measured rect are skipped. An empty column resolves to 0.
 */
export function resolveDropSlot(args: {
  cardRects: CardRectMap;
  pointerY: number;
  movedName: string | null;
  columnNames: string[];
}): number {
  const { cardRects, pointerY, movedName, columnNames } = args;
  let index = 0;
  for (const name of columnNames) {
    if (name === movedName) continue;
    const rect = cardRects.get(name);
    if (!rect) continue;
    const midpoint = (rect.top + rect.bottom) / 2;
    if (midpoint <= pointerY) index++;
  }
  return index;
}

/**
 * Normalise any `over` id to `{ colKey, kind }` — the single place a droppable
 * id becomes a group key.
 *
 * Both `handleDragEnd` branches (card and column) route through this, so a
 * namespaced id (`rail:<k>`, `col-root:<k>`) can never reach persistence as a
 * bogus group key. `kind` is preserved because a rail resolves to the last
 * index while the others resolve by midpoint.
 */
export function resolveDropTarget(over: {
  id: string;
  data?: { type?: string; groupKey?: string } | null;
}): { colKey: string; kind: DropTargetKind } | null {
  const { id, data } = over;
  if (!id) return null;
  if (id.startsWith(RAIL_PREFIX)) {
    const colKey = id.slice(RAIL_PREFIX.length);
    return colKey ? { colKey, kind: "rail" } : null;
  }
  if (id.startsWith(COL_ROOT_PREFIX)) {
    const colKey = id.slice(COL_ROOT_PREFIX.length);
    return colKey ? { colKey, kind: "root" } : null;
  }
  if (data?.type === "card") {
    return data.groupKey ? { colKey: data.groupKey, kind: "card" } : null;
  }
  return { colKey: id, kind: "body" };
}

/**
 * Translate a without-moved slot index into the **rendered** index of the card
 * that hosts the insertion marker.
 *
 * The rendered list still contains the dragged card (the sorting strategy is
 * neutralised), so for a same-column drag any slot at or after the dragged
 * card's rendered position shifts by one — otherwise the dragged card itself
 * would be picked as the marker host. A cross-column drag needs no offset
 * (`movedRenderedIndex === null`).
 *
 * A result at or past the rendered length means "the last slot", which has no
 * following card and is indicated by the append rail instead.
 */
export function markerHostIndex(withoutIndex: number, movedRenderedIndex: number | null): number {
  if (movedRenderedIndex === null) return withoutIndex;
  return withoutIndex >= movedRenderedIndex ? withoutIndex + 1 : withoutIndex;
}

/** Structural equality for the resolved slot — drives the per-move bail-out. */
export function slotsEqual(a: DropSlot | null, b: DropSlot | null): boolean {
  if (a === null || b === null) return a === b;
  return a.colKey === b.colKey && a.index === b.index;
}

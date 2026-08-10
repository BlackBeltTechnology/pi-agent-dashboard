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

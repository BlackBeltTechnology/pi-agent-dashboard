/**
 * Shared geometry for the flow agent-card grid.
 *
 * One source for the live grid (`FlowDashboard`) and the frozen post-flow grid
 * (`FlowSummary`) so the two cannot drift in column minimum, row track or gap.
 * The classes are written as literals (not interpolated from the constants) so
 * Tailwind's source scanner can see them; the constants stay the numeric truth
 * the specs pin against. See change: consolidate-flow-agent-cards (D1, D5).
 */

/** Row-track minimum for a full card (px). */
export const FLOW_CARD_ROW_MIN = 124;
/** Row-track minimum for a compact tile below the pane threshold (px). */
export const FLOW_CARD_ROW_MIN_COMPACT = 76;
/** Grid column minimum (px) — `repeat(auto-fill, minmax(190px, 1fr))`. */
export const FLOW_CARD_COLUMN_MIN = 190;
/** Grid gap (px) — `gap-2`. */
export const FLOW_CARD_GAP = 8;
/** Pane width at or below which the grid collapses to compact tiles (px). */
export const FLOW_CARD_COMPACT_MAX_PX = 480;

/**
 * Outer wrapper: the query container. An element cannot query itself, so the
 * grid below carries the variants against THIS element's inline size — the
 * PANE width, not the viewport. `min-w-0` lets it shrink inside the flex pane.
 */
export const FLOW_CARD_GRID_CONTAINER_CLASS = "@container min-w-0";

/**
 * Inner grid: auto-fill columns, one row track shared by the row's cards, and
 * the compact single-column treatment below {@link FLOW_CARD_COMPACT_MAX_PX}.
 * Cards fill the cell (`h-full` on the `data-step` wrapper + `[&>*]:h-full`).
 */
export const FLOW_CARD_GRID_CLASS =
  "grid gap-2 grid-cols-[repeat(auto-fill,minmax(190px,1fr))] auto-rows-[minmax(124px,auto)]" +
  " @max-[480px]:grid-cols-1 @max-[480px]:auto-rows-[minmax(76px,auto)]";

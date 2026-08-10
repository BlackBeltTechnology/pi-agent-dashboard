/**
 * Accumulated-USD cost formatting — a leaf module with no dependencies.
 *
 * Extracted from `FlowAgentCard.tsx` to break the import cycle
 * `FlowAgentCard -> FlowAgentDetail -> FlowAgentCard`: the card renders the
 * detail view, and the detail view only needed the card for this formatter.
 * A currency formatter living in a card component was incidental placement.
 *
 * See change: cleanup-import-cycles (D2).
 */

/**
 * Format an accumulated USD cost, matching the pi-flows TUI precision
 * (`agent-card.ts`): two decimals at or above $1, four decimals sub-dollar.
 *
 * The sub-dollar branch is load-bearing — flow agent costs are routinely well
 * below $1, where 2 decimals would collapse distinct values to `$0.00`.
 */
export function formatCost(n: number): string {
  return `$${n >= 1 ? n.toFixed(2) : n.toFixed(4)}`;
}

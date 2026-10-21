/**
 * Pure helpers for the OpenSpec board's dependency UI: visibility, the
 * execution-order sort, the "Declare dependencies" hint predicate and the
 * drop rule of the execution-order view.
 *
 * See change: add-openspec-change-dependencies.
 */
import type { OpenSpecChange, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { orderChangesForGroup } from "./openspec-board-order.js";

const WORKFLOW_SCHEMA_NAME = "pi-spec-driven";

/** Whether any change carries a computed `dependencies` entry (false on the fallback poll path). */
export function hasDependencyGraph(changes: readonly OpenSpecChange[]): boolean {
  return changes.some((c) => c.dependencies !== undefined);
}

/**
 * Dependency chips, wave badges and issue badges render when the default
 * schema is `pi-spec-driven` or any change has a `dependencies.yaml`; the
 * graph itself is computed regardless.
 */
export function showDependencyUi(data: Pick<OpenSpecData, "changes" | "workflowSchema">): boolean {
  return (
    data.workflowSchema?.configured === WORKFLOW_SCHEMA_NAME ||
    data.changes.some((c) => c.dependencies?.hasFile === true)
  );
}

/**
 * The "Declare dependencies" hint explains why an undeclared change stays in
 * planning: its `dependencies` artifact is `ready`. Never on the fallback path
 * (no `dependencies` field); independent of `showDependencyUi`.
 */
export function showDeclareHint(c: OpenSpecChange): boolean {
  return c.dependencies !== undefined && c.artifacts.some((a) => a.id === "dependencies" && a.status === "ready");
}

/** Rank: waves 1..n first, then `wave: null` (cycles), then changes without the field. */
function waveRank(c: OpenSpecChange): number {
  if (c.dependencies === undefined) return Number.MAX_SAFE_INTEGER;
  return c.dependencies.wave ?? Number.MAX_SAFE_INTEGER - 1;
}

/** Execution-order view: ascending wave, ties by name. Never reads or writes `changeOrder`. */
export function orderByWave(changes: readonly OpenSpecChange[]): OpenSpecChange[] {
  return [...changes].sort((a, b) => waveRank(a) - waveRank(b) || a.name.localeCompare(b.name));
}

/**
 * Drop rule of the execution-order view: within-column reorder is disabled
 * (own-column drop is a no-op); a drop on another column reassigns the group
 * and appends the card to that column's manual order.
 *
 * `targetManualOrder` is the target column's names in their manual (persisted)
 * order, i.e. what `orderChangesForGroup` yields — never the wave order.
 */
export function executionOrderDrop(args: {
  sourceKey: string;
  targetKey: string;
  movedName: string;
  targetManualOrder: readonly string[];
}): { newTargetOrder: string[] } | null {
  const { sourceKey, targetKey, movedName, targetManualOrder } = args;
  if (sourceKey === targetKey) return null;
  return { newTargetOrder: [...targetManualOrder.filter((n) => n !== movedName), movedName] };
}

/**
 * The source column's names, minus the moved one, in its MANUAL order. In the execution-order view the column
 * is displayed in wave order, so persisting `column.changes` would overwrite the user's manual order with the
 * wave order; resolve it from the stored order instead (identity in the default view).
 */
export function sourceOrderAfterMove(
  columnChanges: OpenSpecChange[],
  persisted: string[] | undefined,
  movedName: string,
): string[] {
  return orderChangesForGroup(columnChanges, persisted)
    .map((c) => c.name)
    .filter((n) => n !== movedName);
}

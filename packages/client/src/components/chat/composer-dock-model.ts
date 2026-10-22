/**
 * Lane model of the composer dock: what a lane adapter hands to `ComposerDock`,
 * the fixed lane order, and the one-open-lane accordion hook.
 *
 * Lanes are thin adapters over existing data: each builds a `DockLane` (or
 * `null` when it has nothing to show) in a hook, and `ComposerDock` owns the
 * layout, the accordion, compact mode and the live region.
 *
 * See change: add-composer-dock (D2, D3).
 */
import { type ReactNode, useCallback, useState } from "react";
import { t } from "../../lib/i18n/i18n.js";

export type DockLaneKey = "processes" | "changes" | "openspec" | "queue" | "context";

/** Fixed lane order, top to bottom. */
export const DOCK_LANE_ORDER: readonly DockLaneKey[] = ["processes", "changes", "openspec", "queue", "context"];

export interface DockLane {
  key: DockLaneKey;
  /** Accessible group name and chip label (use `dockLaneLabel(key)`). */
  label: string;
  /** Decorative lane icon. */
  icon: ReactNode;
  /** Header primary content (truncates before any action hides). */
  title: ReactNode;
  /** Header secondary content (truncates). */
  meta?: ReactNode;
  /** Compact-chip content, e.g. the count. */
  summary: ReactNode;
  /** Plain-text form of the summary for the chip's accessible name (no clock text). */
  summaryText: string;
  /** Header actions; rendered as siblings of the disclosure control, never nested in it. */
  actions?: ReactNode;
  /**
   * Expanded body, called only while the body is shown (so row-mode plugin
   * instances mount only then). Ignored in the row layout for a non-expandable lane.
   */
  renderBody?: () => ReactNode;
  /** `false`: the header is plain content with no disclosure control. */
  expandable: boolean;
  /** Count string for the dock's single polite live region. Never clock text. */
  announce?: string;
  /** Stable test id for the lane's `role="group"` container (kept ids such as `composer-git-container`). */
  testId?: string;
  /**
   * Row layout only: hide the whole lane while its `actions` render no visible
   * content (plugin claims that return `null`), so an empty lane leaves no
   * trace. Plugin groups that render nothing add no DOM; a host `ToolbarGroup`
   * whose content element is empty counts as empty.
   */
  hideWhenEmpty?: boolean;
}

export type MaybeDockLane = DockLane | null | undefined | false;

/** Localized lane label (single source for the group name, chip and toggles). */
export function dockLaneLabel(key: DockLaneKey): string {
  switch (key) {
    case "processes":
      return t("dock.lane.processes", undefined, "Processes");
    case "changes":
      return t("dock.lane.changes", undefined, "Changes");
    case "openspec":
      return t("dock.lane.openspec", undefined, "OpenSpec");
    case "queue":
      return t("dock.lane.queue", undefined, "Queue");
    case "context":
      return t("dock.lane.context", undefined, "Context");
  }
}

/** Drop empty lanes, keep one lane per key (first wins) and sort into the fixed order. */
export function orderLanes(lanes: readonly MaybeDockLane[]): DockLane[] {
  const byKey = new Map<DockLaneKey, DockLane>();
  for (const lane of lanes) {
    if (lane && !byKey.has(lane.key)) byKey.set(lane.key, lane);
  }
  return DOCK_LANE_ORDER.flatMap((key) => {
    const lane = byKey.get(key);
    return lane ? [lane] : [];
  });
}

export interface DockAccordion {
  openLane: DockLaneKey | null;
  setOpenLane: (next: DockLaneKey | null) => void;
}

/**
 * One `openLane` value, reset to `null` whenever `bindKey` (the selected session
 * id) changes, so a session always binds collapsed, including on return.
 * Nothing auto-expands and nothing persists. Derived during render, so there is
 * no frame in which the previous session's lane is open for the new one.
 */
export function useDockAccordion(bindKey: string | null | undefined): DockAccordion {
  const [state, setState] = useState<{ bindKey: string | null | undefined; open: DockLaneKey | null }>({
    bindKey,
    open: null,
  });
  if (state.bindKey !== bindKey) setState({ bindKey, open: null });
  const setOpenLane = useCallback(
    (open: DockLaneKey | null) => setState((prev) => ({ ...prev, open })),
    [],
  );
  return { openLane: state.bindKey === bindKey ? state.open : null, setOpenLane };
}

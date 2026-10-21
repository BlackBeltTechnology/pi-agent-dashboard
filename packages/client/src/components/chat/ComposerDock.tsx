/**
 * ComposerDock — the surface above the composer card that shows the bound
 * session's live context as collapsible lanes (Processes, Changes, OpenSpec,
 * Queue, Context) plus the YOLO footer. A sibling of `CommandInput`, never part
 * of it: the visual join is CSS only (inset by `mx-3`, bottom edge tucked under
 * the card with a negative margin).
 *
 * Owns, and only owns: lane layout, the one-open-lane accordion render, compact
 * mode, the YOLO footer and the single polite live region. Lanes are adapters:
 * Processes is built in (`useProcessesLane`); every other lane is a `DockLane`
 * built by its own hook and handed in through `lanes`. `openLane` is controlled
 * (`useDockAccordion(selectedId)` owns it in App, reset on every bind).
 *
 * - Row layout (≥ 32.5rem column): each lane is a `role="group"`; an expandable
 *   header is one stretched disclosure button (`aria-expanded`/`aria-controls`),
 *   its actions are siblings above it, never nested in it.
 * - Compact layout (< 32.5rem): one sticky chip per lane, every lane included;
 *   a chip opens a sheet below the chips (actions + body), one lane at a time.
 *   `openLane` survives a flip; focus moves to the lane's chip/toggle only if
 *   it was inside the open lane.
 * - Lanes scroll in `composer-dock-scroll`; the YOLO footer is `flex-none`
 *   outside it, so it never scrolls away and never sits under a live region.
 * - The live region announces count strings only (`DockLane.announce`); clock
 *   text lives in leaves outside it.
 * - Nothing renders for `readOnly` (archived) views, or when no lane and no
 *   YOLO footer has content (the always-mounted claim summary mounts add no DOM).
 *
 * See change: add-composer-dock (design D1–D4, D10, D11, D23).
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiChevronDown } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { YoloStatusStore } from "../../lib/access-grants/yolo-status.js";
import { t } from "../../lib/i18n/i18n.js";
import { CHAT_PANE_ROW_TABLE } from "../../lib/layout/chat-pane-row-class.js";
import { useYoloLiveForCwd, YoloDockFooter } from "../access-grant/YoloIndicators.js";
import { type DockLane, type DockLaneKey, type MaybeDockLane, orderLanes } from "./composer-dock-model.js";
import { type ProcessesLaneInput, useProcessesLane } from "./ProcessesLane.js";
import { useDockCompactMode } from "./useDockCompactMode.js";

export interface ComposerDockProps {
  /** Bound session; `undefined` on the folder home (YOLO footer only). */
  session: DashboardSession | undefined;
  /** Archived read-only view: no composer, so no dock and no YOLO footer. */
  readOnly?: boolean;
  /** Directory the YOLO footer is scoped against (session or folder cwd). */
  cwd: string | undefined;
  /** The one expanded lane (controlled; `useDockAccordion`). */
  openLane: DockLaneKey | null;
  onOpenLaneChange: (next: DockLaneKey | null) => void;
  /** The composer column element measured for compact mode. */
  columnEl?: HTMLElement | null;
  /** Inputs of the built-in Processes lane (everything but the session). */
  processes?: Omit<ProcessesLaneInput, "session">;
  /** Lanes built by their own adapters (Changes, OpenSpec, Queue, Context). `null`/falsy = empty lane. */
  lanes?: readonly MaybeDockLane[];
  /** Test seam for the YOLO store. */
  yoloStore?: YoloStatusStore;
}

/**
 * Chrome that sits inside the dock's box but outside its footer: the top border
 * (1px) and the bottom padding tucked under the card (`pb-3`, 12px). The row
 * table's bound is the footer line; the CSS min-height must include this chrome.
 */
const DOCK_CHROME_PX = 13;

const NO_COMMANDS: ProcessesLaneInput["commands"] = [];
const noopKill = () => {};

const LANE_ICON = "flex h-4 w-4 flex-none items-center justify-center text-[var(--text-secondary)] [&>svg]:h-4 [&>svg]:w-4";
const LANE_BODY = "grid max-h-[200px] gap-0.5 overflow-auto pb-2 pr-2";

/** True when `el` holds something a user can see (a claim that renders `null` leaves nothing). */
function hasVisibleContent(el: HTMLElement): boolean {
  return Array.from(el.childNodes).some((node) => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").trim() !== "";
    if (!(node instanceof HTMLElement)) return false;
    // A host `ToolbarGroup` whose content element is empty hides itself (index.css).
    if (node.hasAttribute("data-group")) return (node.querySelector(":scope > [data-group-content]")?.childNodes.length ?? 0) > 0;
    return node.childNodes.length > 0;
  });
}

/** Row layout: whether the lane's actions region renders nothing visible. Watches DOM changes. */
function useActionsEmpty(enabled: boolean, onChange: (empty: boolean) => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [empty, setEmpty] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useLayoutEffect(() => {
    const el = ref.current;
    const apply = (next: boolean) => {
      setEmpty(next);
      onChangeRef.current(next);
    };
    if (!enabled || !el) {
      apply(false);
      return;
    }
    const evaluate = () => apply(!hasVisibleContent(el));
    evaluate();
    const observer = new MutationObserver(evaluate);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      onChangeRef.current(false);
    };
  }, [enabled]);
  return { ref, empty };
}

function LaneRow({
  lane,
  open,
  onToggle,
  onEmptyChange,
}: {
  lane: DockLane;
  open: boolean;
  onToggle: () => void;
  /** Reports whether a `hideWhenEmpty` lane currently renders nothing visible. */
  onEmptyChange: (key: DockLaneKey, empty: boolean) => void;
}) {
  const baseId = useId();
  const bodyId = `${baseId}-body`;
  const laneKey = lane.key;
  const actionsEmpty = useActionsEmpty(
    !!lane.hideWhenEmpty,
    useCallback((empty: boolean) => onEmptyChange(laneKey, empty), [onEmptyChange, laneKey]),
  );
  const content = (
    <>
      <span aria-hidden="true" className={LANE_ICON}>
        {lane.icon}
      </span>
      <span className="min-w-0 shrink-[0.5] truncate font-semibold">{lane.title}</span>
      {lane.meta !== undefined && (
        <span className="min-w-0 flex-1 truncate tabular-nums text-[var(--text-secondary)]">{lane.meta}</span>
      )}
    </>
  );
  return (
    <div
      role="group"
      aria-label={lane.label}
      data-testid={lane.testId ?? `composer-dock-lane-${lane.key}`}
      data-dock-lane={lane.key}
      data-open={open}
      hidden={actionsEmpty.empty || undefined}
      className="border-t border-[var(--border-subtle)] first:border-t-0"
    >
      <div className="relative flex min-h-10 items-center gap-1.5 pl-3 pr-2 text-xs max-md:min-h-11">
        {lane.expandable ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            data-dock-toggle={lane.key}
            onClick={onToggle}
            className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left text-xs text-[var(--text-primary)] after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:-outline-offset-2 focus-visible:after:outline-2 focus-visible:after:outline-[var(--focus-ring)] max-md:min-h-11"
          >
            {content}
            <Icon
              path={mdiChevronDown}
              size={0.8}
              aria-hidden="true"
              className={`flex-none text-[var(--text-secondary)] transition-transform motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
            />
          </button>
        ) : (
          <div className="flex min-h-10 min-w-0 flex-1 items-center gap-2 max-md:min-h-11">{content}</div>
        )}
        {lane.actions !== undefined && (
          <div ref={actionsEmpty.ref} className="relative z-10 flex flex-none items-center gap-1">
            {lane.actions}
          </div>
        )}
      </div>
      {open && lane.expandable && lane.renderBody && (
        <div id={bodyId} className={`${LANE_BODY} pl-9`}>
          {lane.renderBody()}
        </div>
      )}
    </div>
  );
}

function CompactDock({
  lanes,
  openLane,
  onOpenLaneChange,
}: {
  lanes: readonly DockLane[];
  openLane: DockLaneKey | null;
  onOpenLaneChange: (next: DockLaneKey | null) => void;
}) {
  const baseId = useId();
  const sheetId = `${baseId}-sheet`;
  const open = lanes.find((l) => l.key === openLane);
  return (
    <>
      <div
        role="group"
        aria-label={t("dock.chipsLabel", undefined, "Dock lanes")}
        data-testid="composer-dock-chips"
        className="sticky top-0 z-[2] flex flex-wrap items-center gap-1 bg-[var(--bg-secondary)] px-2 py-1.5"
      >
        {lanes.map((lane) => {
          const expanded = lane.key === openLane;
          return (
            <button
              key={lane.key}
              type="button"
              aria-expanded={expanded}
              aria-controls={sheetId}
              aria-label={t("dock.chipName", { lane: lane.label, summary: lane.summaryText }, "{lane}: {summary}")}
              data-dock-toggle={lane.key}
              data-testid={`composer-dock-chip-${lane.key}`}
              onClick={() => onOpenLaneChange(expanded ? null : lane.key)}
              className="focus-ring inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2.5 text-xs font-semibold tabular-nums text-[var(--text-primary)] aria-expanded:border-[var(--accent)] aria-expanded:bg-[var(--accent-soft)] max-md:min-h-11 max-md:min-w-11 max-md:justify-center"
            >
              <span aria-hidden="true" className={LANE_ICON}>
                {lane.icon}
              </span>
              <span>{lane.summary}</span>
            </button>
          );
        })}
      </div>
      {open && (
        <div
          id={sheetId}
          role="group"
          aria-label={open.label}
          data-testid="composer-dock-sheet"
          data-dock-lane={open.key}
          className="border-t border-[var(--border-subtle)]"
        >
          <div className="flex min-h-10 items-center gap-1.5 pl-3 pr-2 text-xs max-md:min-h-11">
            <span className="min-w-0 shrink-[0.5] truncate font-semibold">{open.title}</span>
            {open.meta !== undefined && (
              <span className="min-w-0 flex-1 truncate tabular-nums text-[var(--text-secondary)]">{open.meta}</span>
            )}
            {open.actions !== undefined && <div className="ml-auto flex flex-none items-center gap-1">{open.actions}</div>}
          </div>
          {open.renderBody && <div className={`${LANE_BODY} pl-3`}>{open.renderBody()}</div>}
        </div>
      )}
    </>
  );
}

function ComposerDockInner({
  session,
  cwd,
  openLane,
  onOpenLaneChange,
  columnEl,
  processes,
  lanes: extraLanes,
  yoloStore,
}: Omit<ComposerDockProps, "readOnly">) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [emptyLanes, setEmptyLanes] = useState<ReadonlySet<DockLaneKey>>(new Set());
  const onEmptyChange = useCallback((key: DockLaneKey, empty: boolean) => {
    setEmptyLanes((prev) => {
      if (prev.has(key) === empty) return prev;
      const next = new Set(prev);
      if (empty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const pendingFocusRef = useRef<DockLaneKey | null>(null);
  const openRef = useRef<DockLaneKey | null>(null);

  const { lane: processesLane, mounts } = useProcessesLane({
    session,
    commands: processes?.commands ?? NO_COMMANDS,
    onKill: processes?.onKill ?? noopKill,
    onShowTool: processes?.onShowTool,
    onNavigateToSession: processes?.onNavigateToSession,
  });
  const lanes = orderLanes([processesLane, ...(extraLanes ?? [])]);
  const yoloLive = useYoloLiveForCwd(cwd, yoloStore);

  // A lane that left (its content is gone) is no longer "open": a later arrival
  // must render collapsed, never re-expand on its own.
  const effectiveOpen = lanes.some((l) => l.key === openLane) ? openLane : null;
  openRef.current = effectiveOpen;
  useEffect(() => {
    if (openLane !== null && effectiveOpen === null) onOpenLaneChange(null);
  }, [openLane, effectiveOpen, onOpenLaneChange]);

  // Compact flip: remember whether focus sat inside the open lane while the old
  // layout is still mounted; restore it to that lane's chip/toggle afterwards.
  const compact = useDockCompactMode(columnEl, () => {
    const key = openRef.current;
    const root = rootRef.current;
    if (!key || !root) return;
    const laneEl = root.querySelector(`[data-dock-lane="${key}"]`);
    if (laneEl?.contains(document.activeElement)) pendingFocusRef.current = key;
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per layout flip
  useLayoutEffect(() => {
    const key = pendingFocusRef.current;
    if (!key) return;
    pendingFocusRef.current = null;
    rootRef.current?.querySelector<HTMLElement>(`[data-dock-toggle="${key}"]`)?.focus();
  }, [compact]);

  if (lanes.length === 0 && !yoloLive) return <>{mounts}</>;

  const announce = lanes
    .map((l) => l.announce)
    .filter((a): a is string => !!a)
    .join(". ");
  // Chat-pane row classification (App picks the static table entry by state): the
  // lower bound is the YOLO footer line, or 0 without it; lanes give height by scrolling.
  const rowKey = lanes.length === 0 ? "composer-dock:footer-only" : "composer-dock";
  const rowSpec = CHAT_PANE_ROW_TABLE[rowKey];
  const rowStyle =
    rowSpec?.rowClass === "shrinkable"
      ? { flexShrink: rowSpec.weight, minHeight: yoloLive ? rowSpec.bound + DOCK_CHROME_PX : 0 }
      : undefined;
  const toggle = (key: DockLaneKey) => onOpenLaneChange(effectiveOpen === key ? null : key);
  // Every lane renders nothing visible (claims that return `null`) and no footer: leave no chrome.
  const allEmpty = !yoloLive && !compact && lanes.every((l) => emptyLanes.has(l.key));

  return (
    <>
      {mounts}
      <div
        ref={rootRef}
        data-testid="composer-dock"
        data-layout={compact ? "compact" : "rows"}
        hidden={allEmpty || undefined}
        data-footer-only={lanes.length === 0 ? "true" : undefined}
        data-pane-row={rowKey}
        style={rowStyle}
        className="relative z-0 mx-3 -mb-3 flex min-h-0 shrink flex-col overflow-hidden rounded-t-xl border border-b-0 border-[var(--border-secondary)] bg-[var(--bg-secondary)] pb-3 shadow-[inset_0_1px_0_var(--elevation-rim)]"
      >
        {lanes.length > 0 && (
          <div data-testid="composer-dock-scroll" className="min-h-0 flex-initial overflow-y-auto">
            {compact ? (
              <CompactDock lanes={lanes} openLane={effectiveOpen} onOpenLaneChange={onOpenLaneChange} />
            ) : (
              lanes.map((lane) => (
                <LaneRow
                  key={lane.key}
                  lane={lane}
                  open={effectiveOpen === lane.key}
                  onToggle={() => toggle(lane.key)}
                  onEmptyChange={onEmptyChange}
                />
              ))
            )}
          </div>
        )}
        <YoloDockFooter cwd={cwd} store={yoloStore} />
        {/* Sibling of the lanes and the footer — never an ancestor of either. */}
        <div role="status" aria-live="polite" aria-atomic="true" data-testid="composer-dock-live" className="sr-only">
          {announce}
        </div>
      </div>
    </>
  );
}

export function ComposerDock({ readOnly, ...rest }: ComposerDockProps): ReactNode {
  if (readOnly) return null;
  return <ComposerDockInner {...rest} />;
}

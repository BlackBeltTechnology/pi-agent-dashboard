/**
 * Lane header inside a folder group (session-list Group-by). Anatomy per
 * `openspec/changes/session-list-group-by/mockups/ui-plan.md` §3/§4:
 * glyph ON the lane rail · label (never status-coloured) · sub · selected
 * marker · collapsed rollup · count pill · chevron (right). The header is the
 * lane's collapse `<button aria-expanded aria-controls>`.
 *
 * Collapsed: status lanes show the count only (one status per lane); location
 * lanes show count + the folder-capsule status rollup.
 * See change: session-list-group-by.
 */
import type { LaneId } from "@blackbelt-technology/pi-dashboard-shared/session-group-by.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiCheckboxMultipleBlankOutline, mdiChevronDown, mdiRadioboxMarked, mdiSourceBranch } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { t } from "../../lib/i18n/i18n.js";
import {
  CAPSULE_SEGMENT_ORDER,
  type CapsuleBucket,
  countStatusCapsule,
  statusShapeIcon,
} from "../../lib/session/session-status-visuals.js";

export interface LaneMeta {
  label: string;
  /** CSS color expression for glyph + rail (never for label text). */
  color: string;
  icon: string;
}

/** Resolved per render so a language switch re-labels lanes. */
export function laneMeta(lane: LaneId): LaneMeta {
  switch (lane) {
    case "needs-you":
      return { label: t("sessionList.laneNeedsYou", undefined, "Needs you"), color: "var(--status-needs-you)", icon: statusShapeIcon["needs-you"] ?? "" };
    case "error":
      return { label: t("sessionList.laneFailed", undefined, "Failed"), color: "var(--status-error)", icon: statusShapeIcon.error ?? "" };
    case "working":
      return { label: t("sessionList.laneWorking", undefined, "Working"), color: "var(--status-working)", icon: statusShapeIcon.working ?? "" };
    case "review":
      return { label: t("sessionList.laneToReview", undefined, "To review"), color: "var(--status-unread)", icon: mdiRadioboxMarked };
    case "idle":
      return { label: t("sessionList.laneIdle", undefined, "Idle"), color: "var(--status-idle)", icon: statusShapeIcon.idle ?? "" };
    case "main":
      return { label: t("sessionList.laneMainCheckout", undefined, "Main checkout"), color: "var(--text-tertiary)", icon: mdiSourceBranch };
    case "worktrees":
      return { label: t("sessionList.laneWorktrees", undefined, "Worktrees"), color: "var(--text-tertiary)", icon: mdiCheckboxMultipleBlankOutline };
  }
}

function isLocationLane(lane: LaneId): boolean {
  return lane === "main" || lane === "worktrees";
}

interface Props {
  /** Canonical folder key — scopes test ids. */
  folderKey: string;
  lane: LaneId;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  /** Id of the lane's card container (`aria-controls`). */
  controlsId: string;
  /** Sub label, e.g. the folder branch for the Main checkout lane. */
  sub?: string;
  /** Collapsed + holds the selected session → blue marker. */
  containsSelected?: boolean;
  /** Sessions for the collapsed location-lane rollup. */
  sessions?: DashboardSession[];
  errorSessionIds?: Set<string>;
  retrySessionIds?: Set<string>;
  noticeSessionIds?: Set<string>;
  /** Widget-bar placement per session: true ⇒ widget bar, false ⇒ needs-you, undefined ⇒ unresolved (excluded). */
  widgetBar?: (sessionId: string) => boolean | undefined;
}

const ROLLUP_META: Record<CapsuleBucket, { shape: "needs-you" | "error" | "working" | "idle"; color: string; key: string }> = {
  needsYou: { shape: "needs-you", color: "var(--status-needs-you)", key: "needs-you" },
  error: { shape: "error", color: "var(--status-error)", key: "error" },
  working: { shape: "working", color: "var(--status-working)", key: "working" },
  idle: { shape: "idle", color: "var(--status-idle)", key: "idle" },
};

function rollupLabel(bucket: CapsuleBucket, count: number): string {
  switch (bucket) {
    case "needsYou":
      return t("sessionList.laneRollupNeedsYou", { count }, `${count} needs you`);
    case "error":
      return t("sessionList.laneRollupError", { count }, `${count} failed`);
    case "working":
      return t("sessionList.laneRollupWorking", { count }, `${count} working`);
    case "idle":
      return t("sessionList.laneRollupIdle", { count }, `${count} idle`);
  }
}

/**
 * Inert status rollup for a collapsed location lane — same segments, order,
 * shapes and tokens as the folder capsule, but spans only (it lives inside
 * the lane toggle button, where nested buttons are invalid).
 */
function LaneRollup({
  sessions,
  flags,
  widgetBar,
  testId,
}: {
  sessions: DashboardSession[];
  flags: Parameters<typeof countStatusCapsule>[1];
  widgetBar?: (sessionId: string) => boolean | undefined;
  testId: string;
}) {
  // Same contract as the folder capsule: only an ask_user session RESOLVED as
  // not-widget-bar (explicit false) counts as needs-you; unresolved probes
  // (undefined) stay out until classified.
  const counts = countStatusCapsule(sessions, { ...flags, widgetBar });
  const visible = CAPSULE_SEGMENT_ORDER.filter((b) => counts[b] > 0);
  if (visible.length === 0) return null;
  return (
    <span className="inline-flex flex-none items-center gap-1.5 text-[10px] tabular-nums" data-testid={testId}>
      {visible.map((b) => (
        <span
          key={b}
          role="img"
          aria-label={rollupLabel(b, counts[b])}
          className="inline-flex items-center gap-0.5"
          data-rollup-segment={ROLLUP_META[b].key}
        >
          <span style={{ color: ROLLUP_META[b].color }} className="inline-flex">
            <Icon path={statusShapeIcon[ROLLUP_META[b].shape] ?? ""} size={0.42} />
          </span>
          <span className="text-[var(--text-secondary)]">{counts[b]}</span>
        </span>
      ))}
    </span>
  );
}

export function LaneHeader({
  folderKey,
  lane,
  count,
  collapsed,
  onToggle,
  controlsId,
  sub,
  containsSelected,
  sessions,
  errorSessionIds,
  retrySessionIds,
  noticeSessionIds,
  widgetBar,
}: Props) {
  const meta = laneMeta(lane);
  const countLabel = t("sessionList.laneCount", { count }, count === 1 ? "1 session" : `${count} sessions`);
  const showRollup = collapsed && isLocationLane(lane) && sessions && sessions.length > 0;
  return (
    <div className="flex items-center min-w-0" data-testid={`lane-header-${folderKey}::${lane}`}>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={controlsId}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="lane-header-btn focus-ring flex flex-1 min-w-0 items-center gap-1.5 min-h-[26px] rounded-lg py-[3px] pr-1.5 text-left text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        data-testid={`lane-toggle-${folderKey}::${lane}`}
      >
        {/* Glyph sits centred on the lane rail (x ≈ 8px) — the rail hangs off it. */}
        <span
          aria-hidden="true"
          className="inline-flex h-4 w-4 flex-none items-center justify-center rounded-full bg-[var(--bg-tertiary)]"
          style={{ color: meta.color }}
          data-testid={`lane-glyph-${folderKey}::${lane}`}
        >
          <Icon path={meta.icon} size={0.5} />
        </span>
        <span className="text-[11px] font-semibold tracking-[.02em] whitespace-nowrap">{meta.label}</span>
        {sub && <span className="text-[11px] text-[var(--text-muted)] truncate min-w-0">· {sub}</span>}
        {containsSelected && collapsed && (
          <>
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 flex-none rounded-full bg-[var(--accent-blue)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent-blue)_30%,transparent)]"
              data-testid={`lane-selected-marker-${folderKey}::${lane}`}
            />
            <span className="sr-only">{t("sessionList.laneContainsSelected", undefined, "contains selected session")}</span>
          </>
        )}
        {showRollup && (
          <LaneRollup
            sessions={sessions}
            flags={{ errorSessionIds, retrySessionIds, noticeSessionIds }}
            widgetBar={widgetBar}
            testId={`lane-rollup-${folderKey}::${lane}`}
          />
        )}
        <span
          className="ml-auto flex-none rounded-full border border-[var(--border-subtle)] px-1.5 text-[10px] tabular-nums text-[var(--text-tertiary)]"
          aria-label={countLabel}
          data-testid={`lane-count-${folderKey}::${lane}`}
        >
          {count}
        </span>
        <span
          aria-hidden="true"
          className={`flex-none text-[var(--text-muted)] transition-transform duration-200 motion-reduce:transition-none ${collapsed ? "-rotate-90" : ""}`}
        >
          <Icon path={mdiChevronDown} size={0.45} />
        </span>
      </button>
    </div>
  );
}

/** Rail segment tint for a lane's card container (`--lane-rail`). */
export function laneRailStyle(lane: LaneId): React.CSSProperties {
  return { "--lane-rail": `color-mix(in srgb, ${laneMeta(lane).color} 55%, transparent)` } as React.CSSProperties;
}

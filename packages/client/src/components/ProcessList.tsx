/**
 * ProcessList — repurposed as the **BackgroundProcessesDrawer** for the
 * session card's PROCESS subcard.
 *
 * The filename is preserved to keep diffs small; semantically the component
 * is now the *collapsible drawer* of long-lived PGID children reported by
 * the bridge's `ps` scanner. The per-row `✕` continues to invoke
 * `onKill(pgid)` (SIGTERM→SIGKILL via the bridge's `force_kill` path) —
 * deliberately distinct from the SessionActivityBar's `[⏹]` button, which
 * aborts the agent's current tool call, not the OS process tree.
 *
 * Tooltip discipline:
 *   - drawer ✕  → "Force-kill process tree"   (this file)
 *   - activity bar ⏹ → "Stop this tool (lets the agent continue)" (SessionActivityBar)
 *
 * Changes from the previous (always-expanded) layout:
 *   - `MIN_SLOTS` skeleton padding removed — the SessionActivityBar above
 *     provides the card's stable visual surface, so drawer height bouncing
 *     0→N rows is acceptable.
 *   - Header becomes a clickable summary row: `⚠ N background processes`.
 *   - `expanded` is a controlled prop; parent (SessionCard) owns the
 *     per-session toggle memory.
 *
 * `MAX_VISIBLE` row ceiling + `+N more processes` overflow tail are
 * preserved unchanged.
 *
 * See change: redesign-process-list-activity-bar.
 * See change: tighten-process-list-ux (original ceiling/floor contract).
 */
import React from "react";
import { Icon } from "@mdi/react";
import { mdiClose, mdiChevronDown, mdiChevronRight, mdiAlertOutline, mdiRobotOutline, mdiPowerPlugOutline, mdiCogOutline } from "@mdi/js";
import type { ProcessKind } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

export interface ProcessEntry {
  pid: number;
  pgid: number;
  command: string;
  elapsedMs: number;
  /** Server-supplied classification. Absent ⇒ render as a raw `task`. */
  kind?: ProcessKind;
  label?: string;
  sessionRef?: string;
}

/** Map a process kind to its mdi icon path. */
const KIND_ICON: Record<ProcessKind, string> = {
  "sub-session": mdiRobotOutline,
  "pi-worker": mdiRobotOutline,
  plugin: mdiPowerPlugOutline,
  task: mdiCogOutline,
};

function kindIcon(kind: ProcessKind | undefined): string {
  return KIND_ICON[kind ?? "task"] ?? mdiCogOutline;
}

/** Display text: the friendly label when present, else the raw command. */
function displayLabel(p: ProcessEntry): string {
  return p.label ?? p.command;
}

/**
 * Stable row ceiling: at most this many real process rows are rendered.
 * Excess processes collapse into a single "+N more processes" overflow
 * row with a tooltip listing the hidden command lines.
 *
 * See change: tighten-process-list-ux.
 */
const MAX_VISIBLE = 5;

/** Tooltip copy for the per-row ✕ button. Single source of truth for the
 *  literal string referenced from session-process-tracking/spec.md. */
export const KILL_TOOLTIP = "Force-kill process tree";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}h ${remainMinutes.toString().padStart(2, "0")}m`;
}

function truncateCommand(command: string, maxLen = 40): string {
  if (command.length <= maxLen) return command;
  return command.slice(0, maxLen - 1) + "…";
}

interface VisibleRows {
  visible: ProcessEntry[];
  overflow: ProcessEntry[];
}

/**
 * Pure helper: sort by `elapsedMs` descending, slice to `MAX_VISIBLE`,
 * compute overflow.
 *
 * Skeleton padding (previously gated on a `MIN_SLOTS` floor) has been
 * removed — see change: redesign-process-list-activity-bar (Decision 3).
 *
 * Exported for unit tests.
 */
export function computeVisibleRows(processes: readonly ProcessEntry[]): VisibleRows {
  const sorted = [...processes].sort((a, b) => b.elapsedMs - a.elapsedMs);
  const visible = sorted.slice(0, MAX_VISIBLE);
  const overflow = sorted.slice(MAX_VISIBLE);
  return { visible, overflow };
}

/** One process row: kind icon + (linkable) label + elapsed + kill button. */
function ProcessRow({
  p,
  compact,
  onKill,
  onNavigateToSession,
}: {
  p: ProcessEntry;
  compact: boolean;
  onKill: (pgid: number) => void;
  onNavigateToSession?: (sessionId: string) => void;
}) {
  const iconSize = compact ? 0.45 : 0.5;
  const closeSize = compact ? 0.35 : 0.4;
  const text = compact ? truncateCommand(displayLabel(p), 30) : truncateCommand(displayLabel(p));
  const linkable = p.kind === "sub-session" && !!p.sessionRef && !!onNavigateToSession;
  const rowClass = compact
    ? "flex items-center gap-1.5 text-[11px]"
    : "flex items-center gap-1.5 text-[11px] ml-1 pl-2 border-l border-[var(--border-subtle)]";
  return (
    <div className={rowClass}>
      <Icon path={kindIcon(p.kind)} size={iconSize} className="text-[var(--text-tertiary)] flex-shrink-0" />
      {linkable ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onNavigateToSession!(p.sessionRef!); }}
          className="text-[var(--accent,#3b82f6)] hover:underline truncate flex-1 text-left"
          title={p.command}
        >
          {text}
        </button>
      ) : (
        <span className="text-[var(--text-secondary)] truncate flex-1" title={p.command}>
          {text}
        </span>
      )}
      <span className="text-[var(--text-tertiary)] flex-shrink-0">{formatElapsed(p.elapsedMs)}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onKill(p.pgid); }}
        className="text-[var(--text-muted)] hover:text-red-400 flex-shrink-0 p-0.5"
        title={KILL_TOOLTIP}
        aria-label={KILL_TOOLTIP}
      >
        <Icon path={mdiClose} size={closeSize} />
      </button>
    </div>
  );
}

interface ProcessListProps {
  processes: ProcessEntry[];
  onKill: (pgid: number) => void;
  /** Controlled expansion state. Parent (SessionCard) owns per-session memory. */
  expanded: boolean;
  /** Invoked when the user clicks the summary row. */
  onToggle: () => void;
  compact?: boolean;
  /** Focus/scroll to a referenced session (for `sub-session` rows). */
  onNavigateToSession?: (sessionId: string) => void;
}

export function ProcessList({ processes, onKill, expanded, onToggle, compact, onNavigateToSession }: ProcessListProps) {
  if (processes.length === 0) return null;

  const { visible, overflow } = computeVisibleRows(processes);
  const overflowTitle = overflow.map((p) => p.command).join("\n");
  const summaryText = `${processes.length} background process${processes.length === 1 ? "" : "es"}`;

  const summaryRow = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={expanded}
      data-testid="background-drawer-summary"
      className={`flex items-center gap-1 ${compact ? "text-[11px]" : "text-[11px]"} text-[var(--text-muted)] hover:text-[var(--text-secondary)] w-full text-left`}
    >
      <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.4} />
      <Icon path={mdiAlertOutline} size={0.4} className="text-amber-500/80" />
      <span>{summaryText}</span>
    </button>
  );

  if (compact) {
    return (
      <div className="mt-1 space-y-0.5" data-testid="background-drawer">
        {summaryRow}
        {expanded && (
          <>
            {visible.map((p) => (
              <ProcessRow key={p.pid} p={p} compact onKill={onKill} onNavigateToSession={onNavigateToSession} />
            ))}
            {overflow.length > 0 && (
              <div
                className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]"
                title={overflowTitle}
              >
                <span className="truncate flex-1">+{overflow.length} more processes</span>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mt-1.5" data-testid="background-drawer">
      {summaryRow}
      {expanded && (
        <>
          {visible.map((p) => (
            <ProcessRow key={p.pid} p={p} compact={false} onKill={onKill} onNavigateToSession={onNavigateToSession} />
          ))}
          {overflow.length > 0 && (
            <div
              className="flex items-center gap-1.5 text-[11px] ml-1 pl-2 border-l border-[var(--border-subtle)] text-[var(--text-tertiary)]"
              title={overflowTitle}
            >
              <span className="truncate flex-1">+{overflow.length} more processes</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

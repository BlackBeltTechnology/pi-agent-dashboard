/**
 * SessionActivityBar — renders one row per in-flight `bash` toolCall.
 *
 * Pure component. Input is the list of in-flight bash tools (from
 * `selectInflightBashTools` / `useInflightBashTools`); output is a stack
 * of rows showing `⏵ <command> <elapsed> [⏹]` plus an overflow chip
 * (`+M more ⏵`) when the list exceeds `MAX_VISIBLE`.
 *
 * The `[⏹]` stop button calls the passed `onAbort(toolCallId)`. The
 * dashboard's wire protocol currently exposes only a session-level
 * abort, so the parent (SessionCard) maps every `onAbort` invocation to
 * `handleAbort()` for the session — see design.md Q2 resolution.
 *
 * Known Phase-1 issue: when the bridge's PGID scanner reports a child
 * process whose PGID corresponds to an in-flight bash, that process
 * appears in BOTH the activity bar (here) and the BackgroundProcessesDrawer
 * below. Phase 2 closes the loop by tagging toolCalls with their spawned
 * PGID for honest dedup. See change: redesign-process-list-activity-bar
 * (proposal "Open Questions" → Phase 2 follow-up).
 *
 * See change: redesign-process-list-activity-bar.
 */
import React from "react";
import { Icon } from "@mdi/react";
import { mdiPlay, mdiStopCircleOutline } from "@mdi/js";
import type { InflightBashTool } from "../hooks/useInflightBashTools.js";

/** Visible row cap. Excess rows collapse into a `+N more ⏵` chip.
 *  Decided in design.md Decision 6 (concurrent-bash ceiling). */
export const MAX_VISIBLE = 2;

/** Tooltip copy for the stop button. Single source of truth for the
 *  literal string referenced from session-activity-bar/spec.md. */
export const STOP_TOOLTIP = "Stop this tool (lets the agent continue)";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}h ${remainMinutes.toString().padStart(2, "0")}m`;
}

function truncateCommand(command: string, maxLen = 60): string {
  if (command.length <= maxLen) return command;
  return command.slice(0, maxLen - 1) + "…";
}

interface SessionActivityBarProps {
  /** Unresolved bash tool calls for this session, newest-first. */
  tools: InflightBashTool[];
  /** Invoked when the user clicks the stop button on a row. */
  onAbort: (toolCallId: string) => void;
  /** Current epoch ms — required so elapsed time updates on parent re-render. */
  now: number;
  /** Mobile/compact layout (no header, tighter type). */
  compact?: boolean;
}

export function SessionActivityBar({ tools, onAbort, now, compact }: SessionActivityBarProps) {
  if (tools.length === 0) return null;

  const visible = tools.slice(0, MAX_VISIBLE);
  const overflowCount = Math.max(0, tools.length - MAX_VISIBLE);
  const overflowTitle = tools
    .slice(MAX_VISIBLE)
    .map((t) => t.command)
    .join("\n");

  const containerCls = compact
    ? "space-y-0.5"
    : "mt-1.5 space-y-0.5";

  const textCls = compact ? "text-[11px]" : "text-[11px]";

  return (
    <div
      className={containerCls}
      role="status"
      aria-live="polite"
      data-testid="session-activity-bar"
    >
      {visible.map((t) => (
        <div
          key={t.toolCallId}
          className={`flex items-center gap-1.5 ${textCls}`}
          data-testid="session-activity-row"
        >
          <Icon path={mdiPlay} size={0.4} className="text-green-400 flex-shrink-0" />
          <span
            className="text-[var(--text-secondary)] truncate flex-1"
            title={t.command}
          >
            {truncateCommand(t.command, compact ? 30 : 60)}
          </span>
          <span className="text-[var(--text-tertiary)] flex-shrink-0">
            {formatElapsed(now - t.startedAt)}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAbort(t.toolCallId);
            }}
            className="text-[var(--text-muted)] hover:text-yellow-400 flex-shrink-0 p-0.5"
            title={STOP_TOOLTIP}
            data-testid="session-activity-stop"
            aria-label={STOP_TOOLTIP}
          >
            <Icon path={mdiStopCircleOutline} size={0.45} />
          </button>
        </div>
      ))}
      {overflowCount > 0 && (
        <div
          className={`flex items-center gap-1.5 ${textCls} text-[var(--text-tertiary)]`}
          title={overflowTitle}
          data-testid="session-activity-overflow"
        >
          <Icon path={mdiPlay} size={0.4} className="opacity-0 flex-shrink-0" />
          <span className="truncate flex-1">+{overflowCount} more</span>
          <Icon path={mdiPlay} size={0.35} className="text-[var(--text-muted)] flex-shrink-0" />
        </div>
      )}
    </div>
  );
}

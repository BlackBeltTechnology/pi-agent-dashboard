/**
 * FlowActivityBadge — renderer for the running-flow status pill.
 *
 * Previously claimed the `session-card-badge` slot (which the shell
 * mounts inside the WORKSPACE subcard — wrong place for flow status).
 * The slot claim was dropped in `fix-flows-plugin-polish`; the badge
 * is now consumed only by `SessionFlowActions` (rendered inside the
 * `session-card-flows` slot, i.e. the FLOWS subcard).
 *
 * See change: fix-flows-plugin-polish (A5).
 */
import React, { type ReactNode } from "react";
import { Icon } from "@mdi/react";
import { mdiLoading, mdiCheckCircle, mdiAlertCircle, mdiStopCircle, mdiStop } from "@mdi/js";
import type { FlowStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const statusConfig: Record<string, { icon: ReactNode; color: string }> = {
  running: { icon: <Icon path={mdiLoading} size={0.45} className="animate-spin" />, color: "text-blue-400" },
  success: { icon: <Icon path={mdiCheckCircle} size={0.45} />, color: "text-green-400" },
  error: { icon: <Icon path={mdiAlertCircle} size={0.45} />, color: "text-red-400" },
  aborted: { icon: <Icon path={mdiStopCircle} size={0.45} />, color: "text-orange-400" },
};

export interface FlowActivityBadgeProps {
  flowName: string;
  agentsDone?: number;
  agentsTotal?: number;
  status?: FlowStatus;
  /** When provided AND status === "running", renders an "Abort" button after the badge. */
  onAbort?: () => void;
}

export function FlowActivityBadge({
  flowName,
  agentsDone,
  agentsTotal,
  status,
  onAbort,
}: FlowActivityBadgeProps) {
  const { icon, color } = statusConfig[status ?? "running"] ?? statusConfig.running;
  const isRunning = status === "running";

  return (
    <div className={`text-[11px] flex items-center gap-1 ${color}`}>
      <span className="inline-flex">{icon}</span>
      <span className="truncate flex-1 min-w-0">
        {flowName}
        {isRunning && agentsTotal != null && agentsTotal > 0 && (
          <span className="text-[var(--text-secondary)]"> · {agentsDone ?? 0}/{agentsTotal} agents</span>
        )}
        {!isRunning && (
          <span className="text-[var(--text-secondary)]"> · {status}</span>
        )}
      </span>
      {isRunning && onAbort && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAbort(); }}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
          title="Abort running flow"
        >
          <Icon path={mdiStop} size={0.4} />
          Abort
        </button>
      )}
    </div>
  );
}

import React, { type ReactNode } from "react";
import { Icon } from "@mdi/react";
import { mdiLoading, mdiCheckCircle, mdiAlertCircle, mdiStopCircle } from "@mdi/js";
import type { FlowStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const statusConfig: Record<string, { icon: ReactNode; color: string }> = {
  running: { icon: <Icon path={mdiLoading} size={0.45} className="animate-spin" />, color: "text-blue-400" },
  success: { icon: <Icon path={mdiCheckCircle} size={0.45} />, color: "text-green-400" },
  error: { icon: <Icon path={mdiAlertCircle} size={0.45} />, color: "text-red-400" },
  aborted: { icon: <Icon path={mdiStopCircle} size={0.45} />, color: "text-orange-400" },
};

export function FlowActivityBadge({
  flowName,
  agentsDone,
  agentsTotal,
  status,
}: {
  flowName: string;
  agentsDone?: number;
  agentsTotal?: number;
  status?: FlowStatus;
}) {
  const { icon, color } = statusConfig[status ?? "running"] ?? statusConfig.running;
  const isRunning = status === "running";

  return (
    <div className={`text-[11px] mt-0.5 ml-4 flex items-center gap-1 ${color}`}>
      <span className="inline-flex">{icon}</span>
      <span className="truncate">
        {flowName}
        {isRunning && agentsTotal != null && agentsTotal > 0 && (
          <span className="text-[var(--text-secondary)]"> · {agentsDone ?? 0}/{agentsTotal} agents</span>
        )}
        {!isRunning && (
          <span className="text-[var(--text-secondary)]"> · {status}</span>
        )}
      </span>
    </div>
  );
}

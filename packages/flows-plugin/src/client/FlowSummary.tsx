/**
 * Summary-only sections of a completed flow, rendered by `FlowDashboard` in
 * `summary` mode (the separate `FlowSummary` shell is gone). Exports the
 * completion `statusConfig` map, `FlowSummaryStatus` (header status icon +
 * label + steps · duration · files), `FlowSummarySections` (Summaries list +
 * Next suggestion) and `FlowSummaryRow`.
 * See change: unify-flow-rendering (D1, D3).
 */
import { useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { FlowAgentState, FlowState } from "../types.js";
import { mdiAlertCircle, mdiCheckCircle, mdiChevronDown, mdiChevronRight, mdiCircleOutline, mdiCloseCircle, mdiStopCircle } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useState } from "react";

export const statusConfig: Record<string, { icon: ReactNode; label: string; color: string }> = {
  success: { icon: <Icon path={mdiCheckCircle} size={0.55} />, label: "complete", color: "text-green-400" },
  error: { icon: <Icon path={mdiAlertCircle} size={0.55} />, label: "failed", color: "text-red-400" },
  aborted: { icon: <Icon path={mdiStopCircle} size={0.55} />, label: "aborted", color: "text-orange-400" },
};

/** Completed-flow header status: icon + "<name> complete" + steps · duration · files. */
export function FlowSummaryStatus({ flowState, agents }: { flowState: FlowState; agents: FlowAgentState[] }) {
  const formatDuration = useUiPrimitive(UI_PRIMITIVE_KEYS.formatDuration);
  const { icon, label, color } = statusConfig[flowState.status] ?? statusConfig.success;
  const totalDuration = flowState.flowResult?.totalDuration as number | undefined;
  const totalFiles = agents.reduce((sum, a) => sum + (a.files?.length ?? 0), 0);
  return (
    <>
      <span className={`${color} inline-flex`}>{icon}</span>
      <span className="text-sm text-[var(--text-primary)] flex-1">
        {flowState.flowName} {label}
        <span className="text-[var(--text-tertiary)] ml-1.5">
          · {agents.length} steps
          {totalDuration ? ` · ${formatDuration(totalDuration)}` : ""}
          {totalFiles > 0 ? ` · ${totalFiles} files` : ""}
        </span>
      </span>
    </>
  );
}

/**
 * Summaries list (summary-bearing agents only; hidden when none qualify) and
 * the Next: /step suggestion. Lives in the summary scroll box under the Agent
 * cards. See changes: fix-flow-ui-graph-zoom-summary, unify-flow-rendering (D3).
 */
export function FlowSummarySections({
  flowState,
  agents,
  onSendPrompt,
}: {
  flowState: FlowState;
  agents: FlowAgentState[];
  onSendPrompt?: (text: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const summarised = agents.filter((a) => a.summary);
  return (
    <>
      {summarised.length > 0 && (
        <div className="mt-2 pt-1.5 border-t border-[var(--border-subtle)]">
          <div
            data-testid="flow-summary-toggle"
            className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)] cursor-pointer mb-1 hover:text-[var(--text-primary)]"
            onClick={() => setCollapsed(!collapsed)}
          >
            <Icon path={collapsed ? mdiChevronRight : mdiChevronDown} size={0.5} />
            <span>Summaries ({summarised.length})</span>
          </div>
          {!collapsed && (
            <div className="space-y-0.5" data-testid="flow-summaries">
              {summarised.map((agent) => (
                <FlowSummaryRow key={agent.stepId || agent.agentName} agent={agent} />
              ))}
            </div>
          )}
        </div>
      )}

      {flowState.nextStep && onSendPrompt && (
        <div className="mt-1.5 pt-1.5 border-t border-[var(--border-subtle)]">
          <button
            onClick={() => onSendPrompt(`/${flowState.nextStep}`)}
            className="text-[11px] px-2 py-1 rounded border border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
          >
            Next: /{flowState.nextStep}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * One expandable per-agent row. Collapsed: status icon + label + badges +
 * file count + truncated summary peek (matches prior behaviour). Expanded:
 * full summary (markdown), typed-output chips, file list, soft/hard outcome.
 * Mirrors the ToolCallStep chevron idiom; failed steps auto-expand.
 * See change: expandable-flow-summary-rows.
 */
export function FlowSummaryRow({ agent }: { agent: FlowAgentState }) {
  const MarkdownContent = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
  const fileCount = agent.files?.length ?? 0;
  const outputs = agent.typedOutputs
    ? Object.entries(agent.typedOutputs).filter(([k]) => k !== "branch")
    : [];
  const hasDetail = !!agent.summary || fileCount > 0 || outputs.length > 0;
  const [open, setOpen] = useState(agent.status === "error");

  const agentIconPath = agent.status === "complete" ? mdiCheckCircle
    : agent.status === "error" ? mdiCloseCircle
    : agent.status === "blocked" ? mdiAlertCircle
    : mdiCircleOutline;
  const agentColor = agent.status === "complete" ? "text-green-400"
    : agent.status === "error" ? "text-red-400"
    : agent.status === "blocked" ? "text-orange-400"
    : "text-[var(--text-tertiary)]";

  return (
    <div>
      {/* Header row */}
      <div
        className={`flex items-center gap-1.5 text-[11px] hover:bg-[var(--bg-tertiary)] rounded px-1 py-0.5 ${hasDetail ? "cursor-pointer" : ""}`}
        onClick={hasDetail ? () => setOpen(!open) : undefined}
      >
        <span className="inline-flex w-[11px] justify-center text-[var(--text-muted)]">
          {hasDetail ? <Icon path={open ? mdiChevronDown : mdiChevronRight} size={0.45} /> : null}
        </span>
        <span className={`${agentColor} inline-flex`}><Icon path={agentIconPath} size={0.45} /></span>
        <span className="text-[var(--text-primary)]">{agent.label || agent.stepId || agent.agentName}</span>
        {(agent.stepType === "fork" || agent.stepType === "agent-decision") && (
          <span className="text-[9px] text-amber-400/60">◇</span>
        )}
        {agent.stepType === "agent-loop-decision" && (
          <span className="text-[9px] text-purple-400/60">↻</span>
        )}
        {fileCount > 0 && (
          <span className="text-[var(--text-muted)]">({fileCount} files)</span>
        )}
        {!open && agent.summary && (
          <span className="text-[var(--text-tertiary)] truncate flex-1">{agent.summary}</span>
        )}
      </div>

      {/* Expanded body */}
      {open && hasDetail && (
        <div className="ml-[22px] mt-0.5 mb-1 pl-2.5 pr-2 py-1.5 border-l-2 border-[var(--border-primary)] bg-[var(--bg-surface)] rounded-r flex flex-col gap-1.5">
          {agent.summary && (
            <div className="text-[11px] text-[var(--text-secondary)]">
              <MarkdownContent content={agent.summary} />
            </div>
          )}
          {outputs.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {outputs.map(([k, v]) => (
                <span key={k} className="text-[10px] font-mono bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-1 py-0.5 truncate max-w-[160px]" title={`${k}: ${v}`}>
                  <span className="text-cyan-400">{k}</span>: {v}
                </span>
              ))}
            </div>
          )}
          {fileCount > 0 && (
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] font-mono text-[var(--text-tertiary)]">
              {agent.files?.map((f) => (
                <span key={f} title={f}>{f}</span>
              ))}
            </div>
          )}
          {agent.status === "error" && agent.outcome === "soft" && (
            <div className="text-[10px] text-amber-400">⚠ soft-failed — routed to on_error</div>
          )}
          {agent.status === "error" && agent.outcome === "hard" && (
            <div className="text-[10px] text-red-400">✕ hard-failed — halted flow</div>
          )}
        </div>
      )}
    </div>
  );
}

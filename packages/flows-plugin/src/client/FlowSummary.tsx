import React, { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { Icon } from "@mdi/react";
import { mdiCloseCircleOutline, mdiCheckCircle, mdiAlertCircle, mdiStopCircle, mdiCloseCircle, mdiCircleOutline, mdiChevronRight, mdiChevronDown } from "@mdi/js";
import type { DashboardSession, FlowState, FlowAgentState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { useUiPrimitive, useUiPrimitiveOrNull, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime";
import { FlowGraph, flowStateToGraphSteps } from "./FlowGraph.js";
import { FlowAgentCard } from "./FlowAgentCard.js";
import { FlowYamlPopoverButton } from "./FlowYamlPopoverButton.js";
import { useFlowsSessionState } from "./FlowsSessionStateContext.js";


// formatDuration moved to registry primitive lookup inside FlowSummary
// (PH-2 fix from validation report).


const statusConfig: Record<string, { icon: ReactNode; label: string; color: string }> = {
  success: { icon: <Icon path={mdiCheckCircle} size={0.55} />, label: "complete", color: "text-green-400" },
  error: { icon: <Icon path={mdiAlertCircle} size={0.55} />, label: "failed", color: "text-red-400" },
  aborted: { icon: <Icon path={mdiStopCircle} size={0.55} />, label: "aborted", color: "text-orange-400" },
};

export function FlowSummary({
  flowState,
  onDismiss,
  onSendPrompt,
  session,
  sessionId,
}: {
  flowState: FlowState;
  onDismiss: () => void;
  onSendPrompt?: (text: string) => void;
  /** Parent session — threaded to the frozen cards for their detail/popout affordances. */
  session?: DashboardSession;
  sessionId?: string;
}) {
  const formatDuration = useUiPrimitive(UI_PRIMITIVE_KEYS.formatDuration);
  const Dialog = useUiPrimitiveOrNull(UI_PRIMITIVE_KEYS.dialog);
  const [collapsed, setCollapsed] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  // Shared graph⇄card selection (ephemeral). See change:
  // improve-flow-graph-dialog-and-card-interaction.
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const agents = Array.from(flowState.agents.values());
  const { icon, label, color } = statusConfig[flowState.status] ?? statusConfig.success;
  const totalDuration = flowState.flowResult?.totalDuration as number | undefined;
  const totalFiles = agents.reduce((sum, a) => sum + (a.files?.length ?? 0), 0);

  const handleSelectStep = useCallback((stepId: string) => {
    setSelectedStepId((prev) => (prev === stepId ? null : stepId));
  }, []);

  // Reset selection when the agent set changes (selection is ephemeral).
  useEffect(() => {
    setSelectedStepId(null);
  }, [flowState.agents]);

  // Esc clears selection (the Dialog handles its own Esc independently).
  useEffect(() => {
    if (!selectedStepId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedStepId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedStepId]);

  // Scroll the matching node + card into view on selection (counterpart sync).
  useEffect(() => {
    if (!selectedStepId || !rootRef.current) return;
    const esc = selectedStepId.replace(/["\\]/g, "\\$&");
    for (const attr of ["data-node", "data-step"]) {
      rootRef.current
        .querySelector(`[${attr}="${esc}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [selectedStepId]);

  return (
    <div ref={rootRef} className="bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] px-3 py-2">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`${color} inline-flex`}>{icon}</span>
        <span className="text-sm text-[var(--text-primary)] flex-1">
          {flowState.flowName} {label}
          <span className="text-[var(--text-tertiary)] ml-1.5">
            · {agents.length} steps
            {totalDuration ? ` · ${formatDuration(totalDuration)}` : ""}
            {totalFiles > 0 ? ` · ${totalFiles} files` : ""}
          </span>
        </span>
        <button
          onClick={onDismiss}
          className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        >
          <Icon path={mdiCloseCircleOutline} size={0.4} className="inline mr-0.5" />Dismiss
        </button>
      </div>

      {/* Flow graph — bounded + fit-to-window; ⤢ expand opens the centered Dialog
          with pan/zoom. Bounded so it cannot be dragged over the cards/summaries.
          See change: show-flow-cards-in-summary. */}
      <FlowGraph
        steps={flowStateToGraphSteps(flowState)}
        fit
        selectedStepId={selectedStepId}
        onSelectStep={handleSelectStep}
        onExpand={Dialog ? () => setGraphOpen(true) : undefined}
      />
      {flowState.flowSource && (
        <div className="mt-1">
          <FlowYamlPopoverButton
            flowSource={flowState.flowSource}
            flowName={flowState.flowName}
          />
        </div>
      )}

      {/* Frozen agent cards — UNDER the graph, where they were live. Read-only. */}
      {agents.length > 0 && (
        <div
          className="grid gap-2 mt-2"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(200px, 1fr))` }}
        >
          {agents.map(agent => (
            <FlowAgentCard
              key={agent.stepId || agent.agentName}
              agent={agent}
              session={session}
              sessionId={sessionId ?? session?.id}
              selected={selectedStepId === (agent.stepId || agent.agentName)}
              onSelect={handleSelectStep}
            />
          ))}
        </div>
      )}

      {/* Summaries — collapsible footer; each row expands inline. */}
      <div className="mt-2 pt-1.5 border-t border-[var(--border-subtle)]">
        <div
          data-testid="flow-summary-toggle"
          className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)] cursor-pointer mb-1 hover:text-[var(--text-primary)]"
          onClick={() => setCollapsed(!collapsed)}
        >
          <Icon path={collapsed ? mdiChevronRight : mdiChevronDown} size={0.5} />
          <span>Summaries ({agents.length})</span>
        </div>
        {!collapsed && (
          <div className="space-y-0.5" data-testid="flow-summaries">
            {agents.map(agent => (
              <FlowSummaryRow key={agent.stepId || agent.agentName} agent={agent} />
            ))}
          </div>
        )}
      </div>

      {/* Expanded graph — centered Dialog with pan/zoom. */}
      {Dialog && (
        <Dialog
          open={graphOpen}
          onClose={() => setGraphOpen(false)}
          title={`Flow graph · ${flowState.flowName}`}
          size="full"
        >
          {/* Non-fit (pan/zoom) graph fills the full-size dialog; no inner
              height cap so the horizontal DAG gets a wide stage. See change:
              improve-flow-graph-dialog-and-card-interaction. */}
          <div style={{ height: "82vh", overflow: "hidden" }}>
            <FlowGraph
              steps={flowStateToGraphSteps(flowState)}
              selectedStepId={selectedStepId}
              onSelectStep={handleSelectStep}
            />
          </div>
        </Dialog>
      )}

      {/* Next step suggestion */}
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
    </div>
  );
}

/**
 * One expandable per-agent row. Collapsed: status icon + label + badges +
 * file count + truncated summary peek (matches prior behaviour). Expanded:
 * full summary (markdown), typed-output chips, file list, soft/hard outcome.
 * Mirrors the ToolCallStep chevron idiom; failed steps auto-expand.
 * See change: expandable-flow-summary-rows.
 */
function FlowSummaryRow({ agent }: { agent: FlowAgentState }) {
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

/**
 * Slot-consumer wrapper for the `content-inline-footer` claim. Self-
 * derives flow state, dispatches dismissal via pluginContext.send,
 * navigates agent detail via the plugin-internal UI state context.
 * Returns null when no flow is active. See change:
 * pluginize-flows-via-registry.
 */
export function FlowSummaryClaim({ session }: { session: DashboardSession }) {
  const { flowState } = useFlowsSessionState(session.id);
  const send = usePluginSend();

  if (!flowState) return null;

  return (
    <FlowSummary
      flowState={flowState}
      session={session}
      sessionId={session.id}
      onDismiss={() =>
        send({ type: "flow_control", sessionId: session.id, action: "dismiss_summary" })
      }
      onSendPrompt={(text) =>
        send({ type: "send_prompt", sessionId: session.id, text })
      }
    />
  );
}

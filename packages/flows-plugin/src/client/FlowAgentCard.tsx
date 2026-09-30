import { useT, useUiPrimitive, useUiPrimitiveOrNull } from "@blackbelt-technology/dashboard-plugin-runtime";
// AgentMetricSlot is a slot CONSUMER (Phase-2 decorator slot), not a primitive
// — it stays as a direct import. See add-plugin-ui-primitive-registry Decision 4.
import { AgentMetricSlot } from "@blackbelt-technology/pi-dashboard-client-utils/extension-ui/AgentMetricSlot";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardSession, FlowAgentState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiCallSplit, mdiCodeBraces, mdiCodeTags, mdiEyeOffOutline, mdiEyeOutline, mdiFileDocumentOutline, mdiRefresh, mdiSourceBranch } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useState } from "react";
import { FlowAgentDetail } from "./FlowAgentDetail.js";
import { useOpenFileInEditor } from "./flow-files.js";
import { formatCost } from "./format-cost.js";

export function FlowAgentCard({
  agent,
  selected,
  session,
  sessionId,
  onSelect,
}: {
  agent: FlowAgentState;
  selected?: boolean;
  /** Phase-2 decorator host — used for `agent-metric` filtering by agentId. */
  session?: Pick<DashboardSession, "uiDecorators">;
  /** Session id of the parent flow — threaded to FlowAgentDetail. */
  sessionId?: string;
  /** Toggle shared graph⇄card selection. See change: improve-flow-graph-dialog-and-card-interaction. */
  onSelect?: (stepId: string) => void;
}) {
  const stepId = agent.stepId || agent.agentName;
  const t = useT();
  const AgentCardShell = useUiPrimitive(UI_PRIMITIVE_KEYS.agentCard);
  // Soft lookup: production registers `logBlock` (main.tsx); when absent the
  // code-node preview falls back to the padded placeholder below.
  const LogBlock = useUiPrimitiveOrNull(UI_PRIMITIVE_KEYS.logBlock);
  const formatTokens = useUiPrimitive(UI_PRIMITIVE_KEYS.formatTokens);
  const formatDuration = useUiPrimitive(UI_PRIMITIVE_KEYS.formatDuration);
  const Dialog = useUiPrimitive(UI_PRIMITIVE_KEYS.dialog);
  // File buttons open the file in the host editor (Split view).
  // See change: attach-flow-before-run.
  const openInEditor = useOpenFileInEditor(sessionId);

  // Eye-button detail state: opens the FlowAgentDetail run-history view in a
  // ui:dialog (replaces the prior anchored popover). See change:
  // improve-flow-graph-dialog-and-card-interaction.
  const [detailOpen, setDetailOpen] = useState(false);

  const displayName = agent.label || agent.stepId || agent.agentName;
  const displayRole = agent.cardRole || agent.model || "";
  const isComplete = agent.status === "complete" || agent.status === "error" || agent.status === "blocked";
  // Strip provider prefix for display (e.g., "anthropic/claude-opus-4-6" → "claude-opus-4-6")
  const displayModel = agent.resolvedModel
    ? (agent.resolvedModel.split("/").pop() ?? agent.resolvedModel)
    : "";
  const rawModel = agent.model || "";
  const hasAlias = rawModel.startsWith("@");

  // Node-kind badge. Card type is decided by `nodeKind` (surface-node-kind
  // contract); falls back to `stepType` for runs persisted before the
  // contract. See change: rework-flows-plugin-for-new-pi-flows.
  const kind = agent.nodeKind ?? agent.stepType;
  const isCodeKind = kind === "code" || kind === "code-decision";
  const kindBadge =
    kind === "code"
    ? <span className="text-[9px] text-cyan-400/80 bg-cyan-400/10 px-1 rounded flex-shrink-0 inline-flex items-center gap-0.5"><Icon path={mdiCodeTags} size={0.4} /> code</span>
    : kind === "code-decision"
    ? <span className="text-[9px] text-cyan-400/80 bg-cyan-400/10 px-1 rounded flex-shrink-0 inline-flex items-center gap-0.5"><Icon path={mdiCallSplit} size={0.4} /> decision</span>
    : kind === "fork" || kind === "agent-decision"
    ? <span className="text-[9px] text-amber-400/70 bg-amber-400/10 px-1 rounded flex-shrink-0 inline-flex items-center gap-0.5"><Icon path={mdiSourceBranch} size={0.4} /> fork</span>
    : null;

  // Code-node program logs ride the assistant-text channel; the card's
  // nodeKind makes them "logs". (surface-node-kind D1.)
  const logLines = isCodeKind
    ? agent.detailHistory.flatMap((e) => (e.kind === "text" ? [e.text] : []))
    : [];
  const outputs = agent.typedOutputs ? Object.entries(agent.typedOutputs).filter(([k]) => k !== "branch") : [];

  const headerRight = agent.loopIteration != null && agent.loopIteration > 0 ? (
    <span className="text-[10px] text-blue-400 flex-shrink-0 inline-flex items-center gap-0.5">
      <Icon path={mdiRefresh} size={0.4} />{agent.loopIteration}/{agent.loopMax}
    </span>
  ) : (agent.runCount ?? 1) > 1 ? (
    <span className="text-[10px] text-blue-400 flex-shrink-0 inline-flex items-center gap-0.5">
      <Icon path={mdiRefresh} size={0.4} />{agent.runCount}
    </span>
  ) : kindBadge;

  const stats = isComplete && agent.tokens ? (
    <span>↑{formatTokens(agent.tokens.input)} ↓{formatTokens(agent.tokens.output)}{agent.cost != null && agent.cost > 0 ? ` · ${formatCost(agent.cost)}` : ""} · {formatDuration(agent.duration ?? 0)}</span>
  ) : displayModel ? (
    <span>{displayModel}</span>
  ) : displayRole ? (
    <span>{displayRole}</span>
  ) : null;

  return (
    <div data-step={stepId}>
    <AgentCardShell
      name={displayName}
      status={agent.status}
      headerRight={headerRight}
      stats={stats}
      selected={selected}
      onClick={onSelect ? () => onSelect(stepId) : undefined}
    >
      <div className="flex flex-col flex-1">
        {/* Model alias line (when model uses @role alias) */}
        {hasAlias && (
          <div className="text-[10px] text-[var(--text-tertiary)] truncate">{rawModel}</div>
        )}

        {/* Metric / waiting line */}
        <div className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">
          {agent.status === "pending" && agent.blockedBy.length > 0 ? (
            <span>waiting: {agent.blockedBy.join(", ")}</span>
          ) : null}
        </div>

        {/* Phase-2 agent-metric decorator slot. See change: add-extension-ui-decorations. */}
        <AgentMetricSlot session={session} agentId={agent.agentName} />

        {/* Body: code nodes show a Log preview (program logs); agent nodes
            show their recent tool calls. */}
        {isCodeKind ? (
          logLines.length > 0 && LogBlock ? (
            <div className="mt-1">
              <LogBlock
                label={t("programLog", undefined, "Program log")}
                text={logLines.join("\n")}
                preview
                previewLines={3}
              />
            </div>
          ) : (
            <div className="mt-1 space-y-0">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={`pad-${i}`} className="text-[10px]">&nbsp;</div>
              ))}
            </div>
          )
        ) : (
          <div className="mt-1 space-y-0">
            {agent.recentTools.map((tool, i) => (
              <div key={i} className="text-[10px] text-[var(--text-tertiary)] truncate">
                {i === agent.recentTools.length - 1 ? "▸" : "·"} {tool.toolName} {tool.inputPreview}
              </div>
            ))}
            {/* Pad to 3 lines for consistent height */}
            {Array.from({ length: Math.max(0, 3 - agent.recentTools.length) }).map((_, i) => (
              <div key={`pad-${i}`} className="text-[10px]">&nbsp;</div>
            ))}
          </div>
        )}

        {/* Chosen branch (code-decision / agent-decision) */}
        {agent.branch && (
          <div className="mt-1 text-[10px] font-mono">
            <span className="text-[var(--text-muted)]">branch </span>
            <span className="text-cyan-400 font-semibold">{agent.branch}</span>
          </div>
        )}

        {/* Typed outputs (agent + code contract) */}
        {outputs.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {outputs.map(([k, v]) => (
              <span key={k} className="text-[10px] font-mono bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-1 py-0.5 truncate max-w-[160px]" title={`${k}: ${v}`}>
                <span className="text-cyan-400">{k}</span>: {v}
              </span>
            ))}
          </div>
        )}

        {/* Soft (routed) vs hard (halted) failure outcome */}
        {agent.status === "error" && agent.outcome === "soft" && (
          <div className="mt-1 text-[10px] text-amber-400">⚠ soft-failed — routed to on_error</div>
        )}
        {agent.status === "error" && agent.outcome === "hard" && (
          <div className="mt-1 text-[10px] text-red-400">✕ hard-failed — halted flow</div>
        )}

        {/* Resolved handler target for code nodes */}
        {isCodeKind && agent.codeTarget && (
          <div className="mt-1 text-[10px] text-[var(--text-muted)] font-mono truncate" title={agent.codeTarget}>‹› {agent.codeTarget}</div>
        )}

        {/* View source / detail icons — bottom-right of card */}
        <div className="flex justify-end mt-auto pt-1 gap-1">
            {openInEditor && isCodeKind && agent.codeTarget && (
              <button
                onClick={(e) => { e.stopPropagation(); openInEditor(agent.codeTarget as string); }}
                className="transition-colors p-0.5 rounded inline-flex items-center text-[var(--text-tertiary)] hover:text-cyan-400 hover:bg-[var(--bg-surface)]"
                title={t("openHandlerInEditor", undefined, "Open handler in editor")}
              >
                <Icon path={mdiCodeBraces} size={0.45} />
              </button>
            )}
            {openInEditor && agent.sourcePath && (
              <button
                onClick={(e) => { e.stopPropagation(); openInEditor(agent.sourcePath as string); }}
                className="transition-colors p-0.5 rounded inline-flex items-center text-[var(--text-tertiary)] hover:text-blue-400 hover:bg-[var(--bg-surface)]"
                title={t("openSourceInEditor", { name: displayName }, `Open ${displayName} source in editor`)}
              >
                <Icon path={mdiFileDocumentOutline} size={0.45} />
              </button>
            )}
          <button
            onClick={(e) => { e.stopPropagation(); setDetailOpen((prev) => !prev); }}
            className={`transition-colors px-1.5 py-0.5 rounded text-[11px] inline-flex items-center gap-1 border ${
              detailOpen
                ? "text-blue-400 bg-blue-400/10 border-blue-400/40"
                : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-blue-400 hover:border-blue-400/40 hover:bg-blue-400/10"
            }`}
            title={
              detailOpen
                ? t("closeAgentDetail", { name: displayName }, `Close ${displayName} detail`)
                : t("viewAgentDetail", { name: displayName }, `View ${displayName} detail`)
            }
          >
            <Icon path={detailOpen ? mdiEyeOffOutline : mdiEyeOutline} size={0.55} />
            <span className="text-[10px]">{t("details", undefined, "Details")}</span>
          </button>
          {/* Agent detail opens in the ui:dialog (the dialog title carries the
              agent name; FlowAgentDetail's onBack maps to onClose). `h-[70vh]
              flex flex-col` gives MinimalChatView's `h-full` mode a concrete
              height + flex parent so the body scrolls instead of overflowing.
              See change: improve-flow-graph-dialog-and-card-interaction. */}
          <Dialog
            open={detailOpen}
            onClose={() => setDetailOpen(false)}
            size="lg"
            flush
          >
            {/* STAYS: a DEFINITE height pin, not a duplicated flex context —
                the popout keeps a stable height as the transcript grows.
                See change: fix-flush-dialog-scroll-and-close-collision. */}
            <div className="h-[70vh] overflow-hidden flex flex-col">
              <FlowAgentDetail
                agent={agent}
                onBack={() => setDetailOpen(false)}
                sessionId={sessionId}
              />
            </div>
          </Dialog>
        </div>
      </div>
    </AgentCardShell>
    </div>
  );
}

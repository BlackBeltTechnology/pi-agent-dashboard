import React, { useEffect, useRef, useState } from "react";
import { Icon } from "@mdi/react";
import { mdiRefresh, mdiEyeOutline, mdiEyeOffOutline, mdiFileDocumentOutline, mdiOpenInNew } from "@mdi/js";
import type { DashboardSession, FlowAgentState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
// AgentMetricSlot is a slot CONSUMER (Phase-2 decorator slot), not a primitive
// — it stays as a direct import. See add-plugin-ui-primitive-registry Decision 4.
import { AgentMetricSlot } from "@blackbelt-technology/pi-dashboard-client-utils/extension-ui/AgentMetricSlot";
import { FlowAgentDetail } from "./FlowAgentDetail.js";
import { buildFlowAgentPopoutUrl } from "./popout-url.js";

/**
 * State of the agent-source fetch for the document-icon popover.
 *
 * Self-contained inside FlowAgentCard: when the user clicks the doc icon,
 * we open a popover anchored to that button and fetch the agent's .md
 * via `GET /api/pi-resource-file?path=<sourcePath>`. The bytes are then
 * rendered with the `ui:markdown-content` primitive.
 *
 * See change: add-ui-popover-primitive.
 */
type AgentSourceState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; content: string }
  | { kind: "error"; error: string };

export function FlowAgentCard({
  agent,
  selected,
  session,
  sessionId,
  flowId,
}: {
  agent: FlowAgentState;
  selected?: boolean;
  /** Phase-2 decorator host — used for `agent-metric` filtering by agentId. */
  session?: Pick<DashboardSession, "uiDecorators">;
  /** Session id of the parent flow — required for the popout button. */
  sessionId?: string;
  /** Flow name (acts as flow id in the URL) — required for the popout button. */
  flowId?: string;
}) {
  const popoutUrl = buildFlowAgentPopoutUrl(sessionId, flowId, agent.stepId);
  const popoutEnabled = popoutUrl !== null;
  const handlePopout = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (popoutUrl) window.open(popoutUrl, "_blank", "noopener");
    },
    [popoutUrl],
  );
  const AgentCardShell = useUiPrimitive(UI_PRIMITIVE_KEYS.agentCard);
  const formatTokens = useUiPrimitive(UI_PRIMITIVE_KEYS.formatTokens);
  const formatDuration = useUiPrimitive(UI_PRIMITIVE_KEYS.formatDuration);
  const Popover = useUiPrimitive(UI_PRIMITIVE_KEYS.popover);
  const MarkdownContent = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);

  const sourceButtonRef = useRef<HTMLButtonElement | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceState, setSourceState] = useState<AgentSourceState>({ kind: "idle" });

  // Eye-button popover state: shows the FlowAgentDetail run-history view
  // anchored to the eye button. Replaces the dormant content-view slot
  // claim (FlowAgentDetailClaim) which took over the full chat pane.
  // See change: add-ui-popover-primitive.
  const detailButtonRef = useRef<HTMLButtonElement | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Fetch the agent's .md when the popover opens. Mirrors the pattern of
  // `usePiResourceFileFetch` in the dashboard client: deps include only
  // open + path. Including state in deps causes the cleanup to fire on
  // the idle→loading transition and self-cancel the fetch.
  // See change: add-ui-popover-primitive.
  useEffect(() => {
    if (!sourceOpen) return;
    if (!agent.sourcePath) {
      setSourceState({ kind: "error", error: "No source path recorded for this agent." });
      return;
    }
    let cancelled = false;
    setSourceState({ kind: "loading" });
    fetch(`/api/pi-resource-file?path=${encodeURIComponent(agent.sourcePath)}`)
      .then(async (r) => {
        const json = await r.json();
        if (cancelled) return;
        if (json?.success && typeof json?.data?.content === "string") {
          setSourceState({ kind: "loaded", content: json.data.content });
        } else {
          setSourceState({
            kind: "error",
            error: typeof json?.error === "string" ? json.error : "Failed to read source",
          });
        }
      })
      .catch((err) => {
        if (!cancelled) setSourceState({ kind: "error", error: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [sourceOpen, agent.sourcePath]);

  const displayName = agent.label || agent.stepId || agent.agentName;
  const displayRole = agent.cardRole || agent.model || "";
  const isComplete = agent.status === "complete" || agent.status === "error" || agent.status === "blocked";
  // Strip provider prefix for display (e.g., "anthropic/claude-opus-4-6" → "claude-opus-4-6")
  const displayModel = agent.resolvedModel
    ? (agent.resolvedModel.split("/").pop() ?? agent.resolvedModel)
    : "";
  const rawModel = agent.model || "";
  const hasAlias = rawModel.startsWith("@");

  // Step type badge for non-agent steps
  const stepTypeBadge = agent.stepType === "fork" || agent.stepType === "agent-decision"
    ? <span className="text-[9px] text-amber-400/70 bg-amber-400/10 px-1 rounded flex-shrink-0">◇ fork</span>
    : agent.stepType === "agent-loop-decision"
    ? <span className="text-[9px] text-purple-400/70 bg-purple-400/10 px-1 rounded flex-shrink-0">↻ loop</span>
    : null;

  const headerRight = agent.loopIteration != null && agent.loopIteration > 0 ? (
    <span className="text-[10px] text-blue-400 flex-shrink-0 inline-flex items-center gap-0.5">
      <Icon path={mdiRefresh} size={0.4} />{agent.loopIteration}/{agent.loopMax}
    </span>
  ) : (agent.runCount ?? 1) > 1 ? (
    <span className="text-[10px] text-blue-400 flex-shrink-0 inline-flex items-center gap-0.5">
      <Icon path={mdiRefresh} size={0.4} />{agent.runCount}
    </span>
  ) : stepTypeBadge;

  const stats = isComplete && agent.tokens ? (
    <span>↑{formatTokens(agent.tokens.input)} ↓{formatTokens(agent.tokens.output)} · {formatDuration(agent.duration ?? 0)}</span>
  ) : displayModel ? (
    <span>{displayModel}</span>
  ) : displayRole ? (
    <span>{displayRole}</span>
  ) : null;

  return (
    <AgentCardShell
      name={displayName}
      status={agent.status}
      headerRight={headerRight}
      stats={stats}
      selected={selected}
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

        {/* Recent tools */}
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

        {/* View source / detail icons — bottom-right of card */}
        <div className="flex justify-end mt-auto pt-1 gap-1">
            {agent.sourcePath && (
              <>
                <button
                  ref={sourceButtonRef}
                  onClick={(e) => { e.stopPropagation(); setSourceOpen((prev) => !prev); }}
                  className={`transition-colors p-0.5 rounded inline-flex items-center ${
                    sourceOpen
                      ? "text-blue-400 bg-blue-400/10"
                      : "text-[var(--text-tertiary)] hover:text-blue-400 hover:bg-[var(--bg-surface)]"
                  }`}
                  title={sourceOpen ? `Close ${displayName} source` : `View ${displayName} source`}
                >
                  <Icon path={mdiFileDocumentOutline} size={0.45} />
                </button>
                {sourceOpen && sourceButtonRef.current && (
                  <Popover
                    anchorEl={sourceButtonRef.current}
                    onDismiss={() => setSourceOpen(false)}
                  >
                    <div
                      className="w-[640px] max-w-[90vw] max-h-[70vh] overflow-auto bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md shadow-xl p-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="text-[11px] text-[var(--text-tertiary)] mb-2 font-mono truncate" title={agent.sourcePath}>
                        {agent.sourcePath}
                      </div>
                      {sourceState.kind === "loading" && (
                        <div className="text-xs text-[var(--text-muted)]">Loading…</div>
                      )}
                      {sourceState.kind === "error" && (
                        <div className="text-xs text-red-400">⚠ {sourceState.error}</div>
                      )}
                      {sourceState.kind === "loaded" && (
                        <MarkdownContent content={sourceState.content} />
                      )}
                    </div>
                  </Popover>
                )}
              </>
            )}
          <button
            type="button"
            onClick={handlePopout}
            disabled={!popoutEnabled}
            data-testid="flow-agent-popout-button"
            className={`transition-colors px-1.5 py-0.5 rounded text-[11px] inline-flex items-center gap-1 border ${
              popoutEnabled
                ? "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-blue-400 hover:border-blue-400/40 hover:bg-blue-400/10"
                : "border-[var(--border-subtle)] text-[var(--text-muted)] opacity-50 cursor-not-allowed"
            }`}
            title={popoutEnabled ? `Open ${displayName} in new tab` : "Popout unavailable (no session context)"}
          >
            <Icon path={mdiOpenInNew} size={0.55} />
            <span className="text-[10px]">Popout</span>
          </button>
          <button
            ref={detailButtonRef}
            onClick={(e) => { e.stopPropagation(); setDetailOpen((prev) => !prev); }}
            className={`transition-colors px-1.5 py-0.5 rounded text-[11px] inline-flex items-center gap-1 border ${
              detailOpen
                ? "text-blue-400 bg-blue-400/10 border-blue-400/40"
                : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-blue-400 hover:border-blue-400/40 hover:bg-blue-400/10"
            }`}
            title={detailOpen ? `Close ${displayName} detail` : `View ${displayName} detail`}
          >
            <Icon path={detailOpen ? mdiEyeOffOutline : mdiEyeOutline} size={0.55} />
            <span className="text-[10px]">Details</span>
          </button>
          {detailOpen && detailButtonRef.current && (
            <Popover
              anchorEl={detailButtonRef.current}
              onDismiss={() => setDetailOpen(false)}
            >
              <div
                // `h-[70vh]` (not max-h) gives MinimalChatView's `h-full`
                // popout mode a concrete height to fill, so its inner body
                // scrolls instead of overflowing the popover.
                // See change: fix-flows-plugin-polish (scrollbar fix).
                className="w-[640px] max-w-[90vw] h-[70vh] overflow-hidden bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <FlowAgentDetail
                  agent={agent}
                  onBack={() => setDetailOpen(false)}
                  sessionId={sessionId}
                />
              </div>
            </Popover>
          )}
        </div>
      </div>
    </AgentCardShell>
  );
}

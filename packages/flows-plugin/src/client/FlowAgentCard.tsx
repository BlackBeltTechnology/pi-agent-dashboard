import { useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
// AgentMetricSlot is a slot CONSUMER (Phase-2 decorator slot), not a primitive
// — it stays as a direct import. See add-plugin-ui-primitive-registry Decision 4.
import { AgentMetricSlot } from "@blackbelt-technology/pi-dashboard-client-utils/extension-ui/AgentMetricSlot";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardSession, FlowAgentState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiCallSplit, mdiCodeBraces, mdiCodeTags, mdiEyeOffOutline, mdiEyeOutline, mdiFileDocumentOutline, mdiRefresh, mdiSourceBranch } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useEffect, useState } from "react";
import { FlowAgentDetail } from "./FlowAgentDetail.js";

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
/**
 * Format an accumulated USD cost, matching the pi-flows TUI precision
 * (`agent-card.ts`): two decimals at or above $1, four decimals sub-dollar.
 * Exported so `FlowAgentDetail` renders identical values (DRY, D4).
 */
export function formatCost(n: number): string {
  return `$${n >= 1 ? n.toFixed(2) : n.toFixed(4)}`;
}

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
  const formatTokens = useUiPrimitive(UI_PRIMITIVE_KEYS.formatTokens);
  const formatDuration = useUiPrimitive(UI_PRIMITIVE_KEYS.formatDuration);
  const Dialog = useUiPrimitive(UI_PRIMITIVE_KEYS.dialog);
  const MarkdownContent = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);

  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceState, setSourceState] = useState<AgentSourceState>({ kind: "idle" });

  // Code-handler source popover state. Mirrors the agent-source pair above but
  // keyed on `codeTarget` (the resolved .ts handler path for code /
  // code-decision nodes). The fetched .ts is rendered as a fenced ```ts block
  // so the markdown primitive syntax-highlights it instead of mangling it.
  // See change: open-code-handler-from-flow-card.
  const [codeSourceOpen, setCodeSourceOpen] = useState(false);
  const [codeSourceState, setCodeSourceState] = useState<AgentSourceState>({ kind: "idle" });

  // Eye-button detail state: opens the FlowAgentDetail run-history view in a
  // ui:dialog (replaces the prior anchored popover). See change:
  // improve-flow-graph-dialog-and-card-interaction.
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

  // Fetch the code node's handler .ts when its popover opens. `codeTarget` is
  // emitted absolute by the upstream flow runtime, so it is passed verbatim to
  // the resource-file endpoint (allow-list accepts `<cwd>/.pi/...`).
  // See change: open-code-handler-from-flow-card.
  useEffect(() => {
    if (!codeSourceOpen) return;
    if (!agent.codeTarget) {
      setCodeSourceState({ kind: "error", error: "No handler target recorded for this node." });
      return;
    }
    let cancelled = false;
    setCodeSourceState({ kind: "loading" });
    fetch(`/api/pi-resource-file?path=${encodeURIComponent(agent.codeTarget)}`)
      .then(async (r) => {
        const json = await r.json();
        if (cancelled) return;
        if (json?.success && typeof json?.data?.content === "string") {
          setCodeSourceState({ kind: "loaded", content: json.data.content });
        } else {
          setCodeSourceState({
            kind: "error",
            error: typeof json?.error === "string" ? json.error : "Failed to read handler",
          });
        }
      })
      .catch((err) => {
        if (!cancelled) setCodeSourceState({ kind: "error", error: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [codeSourceOpen, agent.codeTarget]);

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
          <div className="mt-1 space-y-0">
            {logLines.slice(-3).map((line, i) => (
              <div key={i} className="text-[10px] text-[var(--text-tertiary)] truncate font-mono" title={line}>{line}</div>
            ))}
            {Array.from({ length: Math.max(0, 3 - Math.min(3, logLines.length)) }).map((_, i) => (
              <div key={`pad-${i}`} className="text-[10px]">&nbsp;</div>
            ))}
          </div>
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
            {isCodeKind && agent.codeTarget && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setCodeSourceOpen((prev) => !prev); }}
                  className={`transition-colors p-0.5 rounded inline-flex items-center ${
                    codeSourceOpen
                      ? "text-cyan-400 bg-cyan-400/10"
                      : "text-[var(--text-tertiary)] hover:text-cyan-400 hover:bg-[var(--bg-surface)]"
                  }`}
                  title={codeSourceOpen ? "Close handler source" : "View handler source"}
                >
                  <Icon path={mdiCodeBraces} size={0.45} />
                </button>
                <Dialog
                  open={codeSourceOpen}
                  onClose={() => setCodeSourceOpen(false)}
                  title={agent.codeTarget.split("/").pop() || "Handler"}
                  size="lg"
                >
                  <div className="text-[11px] text-[var(--text-tertiary)] font-mono break-all" title={agent.codeTarget}>
                    {agent.codeTarget}
                  </div>
                  <div className="h-[60vh] overflow-y-auto">
                    {codeSourceState.kind === "loading" && (
                      <div className="text-xs text-[var(--text-muted)]">Loading…</div>
                    )}
                    {codeSourceState.kind === "error" && (
                      <div className="text-xs text-red-400">⚠ {codeSourceState.error}</div>
                    )}
                    {codeSourceState.kind === "loaded" && (
                      <MarkdownContent content={"```ts\n" + codeSourceState.content + "\n```"} />
                    )}
                  </div>
                </Dialog>
              </>
            )}
            {agent.sourcePath && (
              <>
                <button
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
                <Dialog
                  open={sourceOpen}
                  onClose={() => setSourceOpen(false)}
                  title={agent.sourcePath.split("/").pop() || "Source"}
                  size="lg"
                >
                  {/* Pinned path header; body scrolls inside a fixed-height
                      region so the dialog stays a fixed size. See change:
                      improve-flow-graph-dialog-and-card-interaction. */}
                  <div className="text-[11px] text-[var(--text-tertiary)] font-mono break-all" title={agent.sourcePath}>
                    {agent.sourcePath}
                  </div>
                  <div className="h-[60vh] overflow-y-auto">
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
                </Dialog>
              </>
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

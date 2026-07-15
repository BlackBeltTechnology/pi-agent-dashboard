/**
 * Custom renderer for the Agent tool (from pi-dashboard-subagents).
 *
 * Card layout:
 *   ┌──────────────────────────────────────────┐
 *   │ ⚡ name        running  ⏱ ▾ ↗           │  <- header + expand toggle + popout
 *   │  "description"                            │
 *   │  ▸ activity line                          │
 *   │  stats line                               │
 *   │  [prompt block (collapsed)]               │
 *   │                                           │
 *   │  ── when expanded ──                      │
 *   │  <SubagentDetailView /> (max-h-[60vh])    │
 *   │  ── when collapsed AND complete ──        │
 *   │  result block                             │
 *   └──────────────────────────────────────────┘
 *
 * See change: add-subagent-inspector.
 */

import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { SubagentDetailView } from "@blackbelt-technology/pi-dashboard-subagents-plugin/client";
import { mdiChevronDown, mdiChevronUp, mdiOpenInNew } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useState } from "react";
import { t as i18nT } from "../../lib/i18n";
import { AgentCardShell } from "../AgentCardShell.js";
import { formatDuration } from "../agent-card-utils.js";
import { ElapsedBadge } from "../ElapsedBadge.js";
import { MarkdownContent } from "../MarkdownContent.js";
import type { ToolRendererProps } from "./types.js";

/** Shape of AgentDetails sent by pi-dashboard-subagents via partialResult.details */
interface AgentDetails {
  displayName?: string;
  description?: string;
  subagentType?: string;
  status?: "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error";
  activity?: string;
  toolUses?: number;
  tokens?: string;
  turnCount?: number;
  maxTurns?: number;
  durationMs?: number;
  modelName?: string;
  tags?: string[];
  agentId?: string;
  error?: string;
}

/** Map AgentDetails status to AgentCardShell status key */
function mapStatus(details: AgentDetails | undefined, toolStatus: string): string {
  if (!details?.status) return toolStatus === "error" ? "error" : toolStatus === "complete" ? "complete" : "running";
  switch (details.status) {
    case "running":
    case "queued":
      return "running";
    case "completed":
    case "steered":
      return "complete";
    case "error":
    case "aborted":
      return "error";
    case "stopped":
      return "stopped";
    default:
      return "running";
  }
}

/** Build a stats string from AgentDetails */
function buildStats(d: AgentDetails): string {
  const parts: string[] = [];
  if (d.modelName) parts.push(d.modelName);
  if (d.tags?.length) parts.push(...d.tags);
  if (d.turnCount != null && d.turnCount > 0) {
    parts.push(d.maxTurns != null ? `⟳${d.turnCount}≤${d.maxTurns}` : `⟳${d.turnCount}`);
  }
  if (d.toolUses != null && d.toolUses > 0) parts.push(`${d.toolUses} tool use${d.toolUses === 1 ? "" : "s"}`);
  if (d.tokens) parts.push(d.tokens);
  return parts.join(" · ");
}

/** Prompt display block */
function PromptBlock({ text }: { text: string }) {
  return (
    <div className="mt-1.5">
      <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-0.5">{i18nT("session.prompt", undefined, "Prompt")}</div>
      {/* Renders a 1000-char prefix but exposes the full text to the copy path
          via `data-copy-text` so a selection over this card copies the whole
          prompt, not the DOM-capped prefix. See change:
          chat-copy-fidelity-intercept. */}
      <pre data-copy-text={text} className="whitespace-pre-wrap text-[11px] text-[var(--text-secondary)] max-h-40 overflow-auto">
        {text.slice(0, 1000)}
      </pre>
    </div>
  );
}

/** Result display block with markdown rendering */
function ResultBlock({ text }: { text: string }) {
  return (
    <div className="mt-1.5">
      <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-0.5">{i18nT("common.result", undefined, "Result")}</div>
      <div className="max-h-80 overflow-auto text-[12px]">
        <MarkdownContent content={text} />
      </div>
    </div>
  );
}

/**
 * Header-right icon cluster: expand toggle + popout button.
 *
 * Pill-style buttons (icon + text label, contrasted border, hover state)
 * so the affordances read clearly. Previously these were sub-pixel icons
 * in `text-tertiary` and easy to miss. Matches the visual treatment
 * applied to `FlowAgentCard` and `FlowArchitect`.
 *
 * See change: fix-flows-plugin-polish (button visibility).
 */
function CardControls({
  expanded,
  onToggleExpand,
  onOpenPopout,
  canPopout,
  elapsed,
}: {
  expanded: boolean;
  onToggleExpand: () => void;
  onOpenPopout: () => void;
  canPopout: boolean;
  elapsed?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {elapsed}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
        className={`transition-colors px-1.5 py-0.5 rounded text-[11px] inline-flex items-center gap-1 border ${
          expanded
            ? "text-blue-400 bg-blue-400/10 border-blue-400/40"
            : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-blue-400 hover:border-blue-400/40 hover:bg-blue-400/10"
        }`}
        title={expanded ? "Collapse subagent timeline" : "Expand to inspect tool calls & messages"}
      >
        <Icon path={expanded ? mdiChevronUp : mdiChevronDown} size={0.55} />
        <span>{expanded ? "Collapse" : "Details"}</span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (canPopout) onOpenPopout();
        }}
        disabled={!canPopout}
        className={`transition-colors px-1.5 py-0.5 rounded text-[11px] inline-flex items-center gap-1 border ${
          canPopout
            ? "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-blue-400 hover:border-blue-400/40 hover:bg-blue-400/10"
            : "border-[var(--border-subtle)] text-[var(--text-muted)] opacity-40 cursor-not-allowed"
        }`}
        title={canPopout ? "Open subagent detail" : "Subagent id not yet available"}
      >
        <Icon path={mdiOpenInNew} size={0.5} />
        <span>{i18nT("common.popout", undefined, "Popout")}</span>
      </button>
    </div>
  );
}

export function AgentToolRenderer({ args, status, result, toolDetails, context }: ToolRendererProps) {
  const details = toolDetails as AgentDetails | undefined;
  const [expanded, setExpanded] = useState(false);
  // Detail popout opens in the shell `ui:dialog` primitive (parity with
  // `flow-agent-detail`), replacing the prior `window.open(..., "_blank")`
  // browser popout that broke on Electron/PWA/mobile.
  // See change: fix-subagent-live-detail-reliability (D4).
  const [detailOpen, setDetailOpen] = useState(false);

  // Derive display values
  const displayName = details?.displayName ?? (args?.subagent_type as string) ?? "Agent";
  const description = details?.description ?? (args?.description as string) ?? "";
  const cardStatus = mapStatus(details, status);
  const promptText = args?.prompt ? String(args.prompt) : undefined;

  const sessionId = context?.sessionId;
  const session = context?.session;
  const agentId = details?.agentId;
  // Popout affordance is enabled only when both the agent id and the session
  // state are available (SubagentDetailView needs both). Disabled otherwise
  // — no dialog opens (spec: "Detail affordance disabled without an agent id").
  const canPopout = Boolean(agentId && session);

  const detailDialog = agentId && session ? (
    <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} size="lg" flush>
      <div className="h-[70vh] overflow-hidden flex flex-col">
        <SubagentDetailView
          session={session}
          agentId={agentId}
          mode="popout"
          sessionId={sessionId}
          onBack={() => setDetailOpen(false)}
        />
      </div>
    </Dialog>
  ) : null;

  // Request a resync when the subagent is still running but its inspector
  // timeline is empty or the map has no entry at all (a gap swallowed its
  // live frames, or the client subscribed after it started and state-replay
  // does not re-synthesize subagent_* events for running agents). The bridge
  // replays the latest snapshot in response.
  // See change: fix-subagent-live-detail-reliability (D2);
  // see change: fix-subagent-inline-expand-resync (inline path parity).
  const requestResyncIfStale = () => {
    if (!agentId || !sessionId || !context?.send) return;
    const sub = session?.subagents.get(agentId);
    const emptyTimeline = !sub?.entries || sub.entries.length === 0;
    // Card status is authoritative for "still running" even when the map has
    // no entry yet (sub === undefined) — that is exactly the not-found case.
    const running = details?.status === "running" || details?.status === "queued" || sub?.status === "running";
    if (running && emptyTimeline) {
      context.send({ type: "subagent_resync_request", sessionId, agentId });
    }
  };

  // Open the detail dialog, resyncing first if the timeline is stale.
  const openDetail = () => {
    setDetailOpen(true);
    requestResyncIfStale();
  };

  // Toggle the inline expanded body; when expanding, resync if stale so the
  // inline timeline hydrates the same way the popout does (previously the
  // inline path skipped resync → "Subagent not found in this session.").
  const toggleExpand = () => {
    if (!expanded) requestResyncIfStale();
    setExpanded((v) => !v);
  };

  const controls = (
    <CardControls
      expanded={expanded}
      onToggleExpand={toggleExpand}
      onOpenPopout={openDetail}
      canPopout={canPopout}
      elapsed={
        details?.status === "running" || details?.status === "queued"
          ? <ElapsedBadge startedAt={details.durationMs ? Date.now() - details.durationMs : undefined} />
          : details?.durationMs
          ? <span className="text-[11px] text-[var(--text-tertiary)]">{formatDuration(details.durationMs)}</span>
          : undefined
      }
    />
  );

  // Inline expanded body — preferred whenever the user has expanded the card,
  // even if details/agentId are partial (SubagentDetailView handles fallbacks).
  const expandedBody = expanded && session && agentId
    ? <div className="mt-2"><SubagentDetailView session={session} agentId={agentId} mode="inline" sessionId={context.sessionId} /></div>
    : null;

  // --- Fallback: no toolDetails (replayed/older sessions) ---
  if (!details) {
    return (
      <AgentCardShell name={displayName} status={cardStatus} headerRight={controls}>
        {description && (
          <div className="text-[11px] text-[var(--text-secondary)] mt-1 truncate">"{description}"</div>
        )}
        {!expanded && promptText && <PromptBlock text={promptText} />}
        {!expanded && result && <ResultBlock text={result} />}
        {expandedBody}
        {detailDialog}
      </AgentCardShell>
    );
  }

  const statsText = buildStats(details);

  // --- Running ---
  if (details.status === "running" || details.status === "queued") {
    return (
      <AgentCardShell
        name={displayName}
        status="running"
        headerRight={controls}
        stats={statsText ? <span>{statsText}</span> : undefined}
      >
        {description && (
          <div className="text-[11px] text-[var(--text-secondary)] mt-1 truncate">"{description}"</div>
        )}
        {details.activity && (
          <div className="text-[10px] text-[var(--text-tertiary)] mt-1 truncate">▸ {details.activity}</div>
        )}
        {!expanded && promptText && <PromptBlock text={promptText} />}
        {expandedBody}
        {detailDialog}
      </AgentCardShell>
    );
  }

  // --- Completed / Steered ---
  if (details.status === "completed" || details.status === "steered") {
    return (
      <AgentCardShell
        name={displayName}
        status="complete"
        headerRight={controls}
        stats={statsText ? <span>{statsText}</span> : undefined}
      >
        {description && (
          <div className="text-[11px] text-[var(--text-secondary)] mt-1 truncate">"{description}"</div>
        )}
        {details.status === "steered" && (
          <div className="text-[11px] text-orange-400 mt-0.5">{i18nT("session.wrappedUpTurnLimit", undefined, "Wrapped up (turn limit)")}</div>
        )}
        {!expanded && promptText && <PromptBlock text={promptText} />}
        {!expanded && result && <ResultBlock text={result} />}
        {expandedBody}
        {detailDialog}
      </AgentCardShell>
    );
  }

  // --- Error / Aborted / Stopped ---
  const isError = details.status === "error" || details.status === "aborted";
  return (
    <AgentCardShell
      name={displayName}
      status={isError ? "error" : "stopped"}
      headerRight={controls}
      stats={statsText ? <span>{statsText}</span> : undefined}
    >
      {description && (
        <div className="text-[11px] text-[var(--text-secondary)] mt-1 truncate">"{description}"</div>
      )}
      {details.status === "error" && details.error && (
        <div className="text-[11px] text-red-400 mt-1">{i18nT("common.error", undefined, "Error:")} {details.error}</div>
      )}
      {details.status === "aborted" && (
        <div className="text-[11px] text-orange-400 mt-1">{i18nT("session.abortedMaxTurnsExceeded", undefined, "Aborted (max turns exceeded)")}</div>
      )}
      {details.status === "stopped" && (
        <div className="text-[11px] text-[var(--text-muted)] mt-1">{i18nT("status.stopped", undefined, "Stopped")}</div>
      )}
      {!expanded && promptText && <PromptBlock text={promptText} />}
      {!expanded && result && <ResultBlock text={result} />}
      {expandedBody}
      {detailDialog}
    </AgentCardShell>
  );
}

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
import React, { useState } from "react";
import { Icon } from "@mdi/react";
import { mdiChevronDown, mdiChevronUp, mdiOpenInNew } from "@mdi/js";
import type { ToolRendererProps } from "./types.js";
import { AgentCardShell } from "../AgentCardShell.js";
import { formatDuration } from "../agent-card-utils.js";
import { ElapsedBadge } from "../ElapsedBadge.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { SubagentDetailView } from "@blackbelt-technology/pi-dashboard-subagents-plugin/client";

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
      <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Prompt</div>
      <pre className="whitespace-pre-wrap text-[11px] text-[var(--text-secondary)] max-h-40 overflow-auto">
        {text.slice(0, 1000)}
      </pre>
    </div>
  );
}

/** Result display block with markdown rendering */
function ResultBlock({ text }: { text: string }) {
  return (
    <div className="mt-1.5">
      <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Result</div>
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
  popoutUrl,
  elapsed,
}: {
  expanded: boolean;
  onToggleExpand: () => void;
  popoutUrl?: string;
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
          if (popoutUrl) window.open(popoutUrl, "_blank", "noopener");
        }}
        disabled={!popoutUrl}
        className={`transition-colors px-1.5 py-0.5 rounded text-[11px] inline-flex items-center gap-1 border ${
          popoutUrl
            ? "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-blue-400 hover:border-blue-400/40 hover:bg-blue-400/10"
            : "border-[var(--border-subtle)] text-[var(--text-muted)] opacity-40 cursor-not-allowed"
        }`}
        title={popoutUrl ? "Open subagent in new tab" : "Subagent id not yet available"}
      >
        <Icon path={mdiOpenInNew} size={0.5} />
        <span>Popout</span>
      </button>
    </div>
  );
}

export function AgentToolRenderer({ args, status, result, toolDetails, context }: ToolRendererProps) {
  const details = toolDetails as AgentDetails | undefined;
  const [expanded, setExpanded] = useState(false);

  // Derive display values
  const displayName = details?.displayName ?? (args?.subagent_type as string) ?? "Agent";
  const description = details?.description ?? (args?.description as string) ?? "";
  const cardStatus = mapStatus(details, status);
  const promptText = args?.prompt ? String(args.prompt) : undefined;

  const sessionId = context?.sessionId;
  const session = context?.session;
  const agentId = details?.agentId;
  const popoutUrl = sessionId && agentId ? `/session/${sessionId}/subagent/${agentId}` : undefined;

  const controls = (
    <CardControls
      expanded={expanded}
      onToggleExpand={() => setExpanded((v) => !v)}
      popoutUrl={popoutUrl}
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
          <div className="text-[11px] text-orange-400 mt-0.5">Wrapped up (turn limit)</div>
        )}
        {!expanded && promptText && <PromptBlock text={promptText} />}
        {!expanded && result && <ResultBlock text={result} />}
        {expandedBody}
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
        <div className="text-[11px] text-red-400 mt-1">Error: {details.error}</div>
      )}
      {details.status === "aborted" && (
        <div className="text-[11px] text-orange-400 mt-1">Aborted (max turns exceeded)</div>
      )}
      {details.status === "stopped" && (
        <div className="text-[11px] text-[var(--text-muted)] mt-1">Stopped</div>
      )}
      {!expanded && promptText && <PromptBlock text={promptText} />}
      {!expanded && result && <ResultBlock text={result} />}
      {expandedBody}
    </AgentCardShell>
  );
}

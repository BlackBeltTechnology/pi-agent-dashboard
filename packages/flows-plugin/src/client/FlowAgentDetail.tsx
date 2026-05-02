import React from "react";
import { Icon } from "@mdi/react";
import { mdiArrowLeft, mdiCheckCircle, mdiCloseCircle, mdiAlertCircle, mdiCircle, mdiCircleOutline } from "@mdi/js";
import type { FlowAgentState, FlowDetailEntry } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { MarkdownContent } from "../../../client/src/components/MarkdownContent.js";

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return Math.round(n / 1000) + "k";
}

function formatDuration(ms: number): string {
  const sec = ms / 1000;
  return sec < 60 ? `${sec.toFixed(1)}s` : `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`;
}

function extractInputPreview(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const inp = input as Record<string, unknown>;
  switch (toolName.toLowerCase()) {
    case "read":
    case "write":
    case "edit":
      return String(inp.file_path || inp.path || "");
    case "bash":
      return String(inp.command || "").slice(0, 80);
    case "grep":
      return String(inp.pattern || "").slice(0, 40);
    default:
      return JSON.stringify(input).slice(0, 60);
  }
}

function ToolCallEntry({ entry }: { entry: FlowDetailEntry & { kind: "tool" } }) {
  const preview = extractInputPreview(entry.toolName, entry.input);
  const hasOutput = entry.output !== undefined;
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className={`border-l-2 pl-3 py-1.5 ${entry.isError ? "border-red-500/50" : "border-blue-500/30"}`}>
      <div
        className="flex items-center gap-1.5 cursor-pointer"
        onClick={() => hasOutput && setExpanded(!expanded)}
      >
        <span className={`text-xs font-mono ${entry.isError ? "text-red-400" : "text-blue-400"}`}>
          {entry.toolName}
        </span>
        <span className="text-xs text-[var(--text-tertiary)] truncate">{preview}</span>
        {hasOutput && (
          <span className="text-[10px] text-[var(--text-muted)] ml-auto flex-shrink-0">
            {expanded ? "▾" : "▸"}
          </span>
        )}
      </div>
      {expanded && hasOutput && (
        <pre className="text-[11px] text-[var(--text-secondary)] mt-1 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-words bg-[var(--bg-tertiary)] rounded p-2">
          {typeof entry.output === "string" ? entry.output : JSON.stringify(entry.output, null, 2)}
        </pre>
      )}
    </div>
  );
}

function TextEntry({ text }: { text: string }) {
  return (
    <div className="py-1.5 pl-3">
      <MarkdownContent content={text} />
    </div>
  );
}

function ThinkingEntry({ text }: { text: string }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div className="py-1 pl-3">
      <div
        className="flex items-center gap-1 cursor-pointer text-[11px] text-purple-400/70"
        onClick={() => setExpanded(!expanded)}
      >
        <span>{expanded ? "▾" : "▸"}</span>
        <span>Thinking</span>
      </div>
      {expanded && (
        <pre className="text-[11px] text-[var(--text-muted)] mt-1 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
          {text}
        </pre>
      )}
    </div>
  );
}

export function FlowAgentDetail({
  agent,
  onBack,
}: {
  agent: FlowAgentState;
  onBack: () => void;
}) {
  const displayName = agent.label || agent.agentName;
  const isComplete = agent.status === "complete" || agent.status === "error" || agent.status === "blocked";

  const statusIconPath = agent.status === "complete" ? mdiCheckCircle
    : agent.status === "error" ? mdiCloseCircle
    : agent.status === "blocked" ? mdiAlertCircle
    : agent.status === "running" ? mdiCircle
    : mdiCircleOutline;

  const statusColor = agent.status === "complete" ? "text-green-400"
    : agent.status === "error" ? "text-red-400"
    : agent.status === "blocked" ? "text-orange-400"
    : agent.status === "running" ? "text-yellow-400"
    : "text-[var(--text-tertiary)]";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] flex items-center gap-2">
        <button
          onClick={onBack}
          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <Icon path={mdiArrowLeft} size={0.7} />
        </button>
        <span className={`${statusColor} inline-flex`}><Icon path={statusIconPath} size={0.6} /></span>
        <span className="text-sm font-medium text-[var(--text-primary)]">{displayName}</span>
        {agent.model && (
          <span className="text-[11px] text-[var(--text-tertiary)]">{agent.model}</span>
        )}
        {isComplete && agent.tokens && (
          <span className="text-[11px] text-[var(--text-muted)] ml-auto">
            ↑{formatTokens(agent.tokens.input)} ↓{formatTokens(agent.tokens.output)} · {formatDuration(agent.duration ?? 0)}
          </span>
        )}
      </div>

      {/* Detail history */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {agent.detailHistory.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)] py-4 text-center">
            {agent.status === "pending" ? "Waiting to start..." : "No activity yet"}
          </div>
        ) : (
          agent.detailHistory.map((entry, i) => {
            switch (entry.kind) {
              case "tool":
                return <ToolCallEntry key={i} entry={entry} />;
              case "text":
                return <TextEntry key={i} text={entry.text} />;
              case "thinking":
                return <ThinkingEntry key={i} text={entry.text} />;
              case "error":
                return (
                  <div key={i} className="py-1.5 pl-3 text-sm text-red-400">
                    {entry.text}
                  </div>
                );
              default:
                return null;
            }
          })
        )}

        {/* Summary at bottom */}
        {agent.summary && (
          <div className="mt-3 pt-2 border-t border-[var(--border-subtle)]">
            <div className="text-[11px] text-[var(--text-muted)] mb-1">Summary</div>
            <MarkdownContent content={agent.summary} />
          </div>
        )}
      </div>
    </div>
  );
}
